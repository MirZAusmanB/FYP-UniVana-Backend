const express = require("express");
const auth = require("../middleware/auth");
const UserProfile = require("../models/userProfile");
const University = require("../models/university");
const Program = require("../models/program");
const Country = require("../models/country");
const Recommendation = require("../models/recommendation");
const { embedQuery, vectorSearch } = require("../lib/retrieval");

const router = express.Router();

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const SCHEMA_VERSION = 4;

// Weights sum to 100 and define the maximum points each factor can contribute
// to a country's overall match score.
const WEIGHTS = {
  vector:    30, // Field of interest (semantic match against programs + uni)
  cgpa:      25, // Academic readiness
  budget:    20, // Budget vs typical international tuition
  preferred: 15, // Preferred-country boost
  english:   10, // English proficiency
};

// The 5 scraped countries plus typical international-student tuition baseline
// (USD/year, rough public-uni average). Used for budget scoring AND for the
// tuition chart in the "More details" popup. Sources cited in the UI as
// "typical public-university tuition for international students".
const COUNTRIES = [
  { code: "FR", name: "France",  slug: "france",  typicalTuitionUsd: 3000  },
  { code: "DE", name: "Germany", slug: "germany", typicalTuitionUsd: 1500  },
  { code: "IT", name: "Italy",   slug: "italy",   typicalTuitionUsd: 4000  },
  { code: "NO", name: "Norway",  slug: "norway",  typicalTuitionUsd: 10000 },
  { code: "SE", name: "Sweden",  slug: "sweden",  typicalTuitionUsd: 12000 },
];

const SYSTEM_PROMPT = `You are UniVana's recommendation explainer. The user profile and a list of pre-ranked candidate countries and universities are provided. The ranking has already been computed from vector similarity. Your job is ONLY to write short, grounded reasons.

STRICT RULES:
1. Do NOT change the country ordering. You may slightly reorder universities within a country if a tie clearly resolves.
2. Every reason must reference a SPECIFIC profile field or candidate field. No generic praise.
3. Reasons must be 1 short sentence each. 2-3 reasons per country, 2-3 per university.
4. Do NOT invent facts not present in the profile or candidate data.
5. Return ONLY valid JSON matching the requested schema. No prose, no markdown.`;

// Build a focused "interests" blob for embedding. We deliberately EXCLUDE
// numbers (CGPA, budgets, English score) — those become filters/flags.
// Mixing them into the embedding dilutes the semantic signal that drives
// university matching.
function buildInterestsBlob(profile) {
  const fields = (profile.targetFields || []).join(", ");
  // Repeat target fields a few times so the embedding weighs them heavier
  // than the longer bio text (Jina v3 averages tokens, so repetition shifts
  // the centroid toward the repeated content).
  const weightedFields = fields ? `${fields}. ${fields}. ${fields}.` : "";
  const parts = [
    weightedFields,
    profile.targetDegreeLevel && fields
      ? `${profile.targetDegreeLevel} in ${fields}`
      : profile.targetDegreeLevel,
    (profile.studyPriorities || []).join(", "),
    profile.currentProgram,
    profile.profileBio,
  ];
  return parts.filter((p) => p && String(p).trim()).join(". ");
}

// What fraction of the important profile fields are filled. Used both as
// a gate (refuse if too low) and as a UI signal.
function profileCompleteness(profile) {
  const keys = [
    "fullName", "currentCountry", "citizenshipCountry",
    "currentEducationLevel", "currentProgram", "currentCGPA",
    "targetDegreeLevel", "targetFields", "preferredCountries",
    "intendedIntakeYear", "tuitionBudgetMax", "englishTestTaken",
    "englishScore", "profileBio",
  ];
  let filled = 0;
  for (const k of keys) {
    const v = profile[k];
    if (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && String(v).trim() !== "") {
      filled += 1;
    }
  }
  return Math.round((filled / keys.length) * 100);
}

// Required to generate ANY recommendation. Without these we have nothing
// to embed.
function profileGate(profile) {
  const missing = [];
  if (!profile.targetDegreeLevel) missing.push("targetDegreeLevel");
  if (!profile.targetFields || profile.targetFields.length === 0) missing.push("targetFields");
  const hasContext =
    (profile.profileBio && profile.profileBio.trim()) ||
    (profile.currentProgram && profile.currentProgram.trim()) ||
    (profile.studyPriorities && profile.studyPriorities.length > 0);
  if (!hasContext) missing.push("profileBio_or_currentProgram_or_studyPriorities");
  return missing;
}

// 0..1 normalised "fit" functions. Each is multiplied by its weight when
// scoring a country. Missing input returns null → factor contributes 0
// and the country's max-possible score drops by that weight.

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// Academic readiness. Normalises across common scales (4 / 10 / 100) then
// maps "fail/low" → 0 and "very strong" → 1 linearly between thresholds.
function cgpaFit(cgpa) {
  if (cgpa == null || isNaN(cgpa)) return null;
  const num = Number(cgpa);
  let n;
  if (num <= 4)       n = num / 4;
  else if (num <= 10) n = num / 10;
  else                n = num / 100;
  // Below 0.5 → 0; between 0.5 and 0.9 → linear 0..1; >= 0.9 → 1.
  return clamp01((n - 0.5) / 0.4);
}

// Tuition fit per country. 1.0 when the user's budget covers the typical
// international tuition; linear down to 0 when budget == 0.
function budgetFit(budgetMax, typicalTuitionUsd) {
  if (budgetMax == null) return null;
  return clamp01(budgetMax / Math.max(1, typicalTuitionUsd));
}

// English proficiency (IELTS scale). 5.5 → 0, 7.5+ → 1.
function englishFit(score) {
  if (score == null) return null;
  return clamp01((Number(score) - 5.5) / 2.0);
}

// Trim a university doc to the fields the LLM actually needs. Smaller prompt
// = faster Groq + less hallucination surface.
function trimUni(u) {
  return {
    slug: u.slug,
    name: u.name,
    city: u.city || "",
    description: (u.description || "").slice(0, 300),
    tags: u.tags || [],
    students_total: u.students?.total || null,
    international_percent: u.students?.international_percent || null,
  };
}

// Deterministic fallback used when Groq is unreachable or returns invalid JSON.
function templatedReasons(profile, country) {
  const field = (profile.targetFields || [])[0] || "your target field";
  const out = [`Strong match in ${field} based on the country's program offerings.`];
  if ((profile.preferredCountries || []).includes(country.name)) {
    out.push(`${country.name} is in your preferred countries list.`);
  }
  return out;
}

function templatedUniReasons(profile, uni) {
  const out = [];
  if (uni.city) out.push(`Located in ${uni.city}.`);
  if (uni.international_percent) {
    out.push(`International student share: ${uni.international_percent}%.`);
  }
  if (out.length === 0) out.push(`A relevant match based on your interests.`);
  return out;
}

// Ask Groq to write reasons. Single retry on invalid JSON; caller falls back
// to templated reasons on second failure.
async function callGroq(profile, payloadForLLM) {
  const user = {
    profile: {
      citizenshipCountry: profile.citizenshipCountry || null,
      targetDegreeLevel: profile.targetDegreeLevel || null,
      targetFields: profile.targetFields || [],
      preferredCountries: profile.preferredCountries || [],
      currentCGPA: profile.currentCGPA ?? null,
      currentProgram: profile.currentProgram || null,
      tuitionBudgetMax: profile.tuitionBudgetMax ?? null,
      livingBudgetMax: profile.livingBudgetMax ?? null,
      englishTestTaken: profile.englishTestTaken || null,
      englishScore: profile.englishScore ?? null,
      studyPriorities: profile.studyPriorities || [],
      profileBio: profile.profileBio || null,
    },
    candidates: payloadForLLM,
    expected_output: {
      countries: [
        {
          code: "string",
          reasons: ["string (2-3 items)"],
          universities: [
            { slug: "string", reasons: ["string (2-3 items)"] },
          ],
        },
      ],
    },
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(user) },
        ],
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error("[recommend] Groq error", resp.status, body.slice(0, 200));
      continue;
    }
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content;
    try {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.countries)) return parsed;
    } catch (_) {}
    console.warn("[recommend] Groq returned invalid JSON, attempt", attempt + 1);
  }
  return null;
}

// Run the full computation. Returns the payload to cache and return.
async function generate(profile) {
  const completeness = profileCompleteness(profile);
  const missing = profileGate(profile);
  if (missing.length) {
    return {
      status: "needs_more_info",
      missing,
      profileCompleteness: completeness,
    };
  }

  const interests = buildInterestsBlob(profile);
  const queryVec = await embedQuery(interests);

  // Program-level vector search across the whole corpus. Program docs carry
  // discipline / degree / name which align directly with the user's target
  // fields, so this signal is much sharper than matching against university
  // descriptions alone.
  const programHits = await vectorSearch(Program, queryVec, 200, null);

  // Aggregate top-3 program scores per university_slug. Top-3 mean rewards
  // universities offering MULTIPLE relevant programs over those with a
  // single tangential match.
  const programScoreBySlug = new Map();
  const programBuckets = new Map();
  for (const p of programHits) {
    const slug = p.university_slug;
    if (!slug) continue;
    const arr = programBuckets.get(slug) || [];
    arr.push(p.vecScore || 0);
    programBuckets.set(slug, arr);
  }
  for (const [slug, scores] of programBuckets.entries()) {
    scores.sort((a, b) => b - a);
    const top = scores.slice(0, 3);
    const mean = top.reduce((s, v) => s + v, 0) / top.length;
    programScoreBySlug.set(slug, mean);
  }

  // Per-country university vector search.
  const perCountry = await Promise.all(
    COUNTRIES.map(async (c) => {
      const unis = await vectorSearch(University, queryVec, 20, { country_id: c.code });
      // Blend: 0.4 * university semantic + 0.6 * program-aggregate semantic.
      // Programs carry the actual disciplines, so they're weighted higher.
      // Unis with NO matching programs in the top-200 fall back to pure uni
      // score (but get pushed down naturally).
      for (const u of unis) {
        const progScore = programScoreBySlug.get(u.slug) || 0;
        const uniScore = u.vecScore || 0;
        u.blendedScore = progScore > 0
          ? 0.4 * uniScore + 0.6 * progScore
          : uniScore * 0.7;
        u.programScore = progScore;
        u.vecScore = u.blendedScore;
      }
      unis.sort((a, b) => b.blendedScore - a.blendedScore);
      return { country: c, unis: unis.slice(0, 15) };
    })
  );

  // Score each country: weighted sum of factor fits, total caps at 100.
  const tuitionMax = profile.tuitionBudgetMax;
  const englishOK = profile.englishScore && profile.englishScore >= 6.5;
  const preferred = new Set((profile.preferredCountries || []).map((s) => s.toLowerCase()));

  const cgpaF = cgpaFit(profile.currentCGPA);            // 0..1 or null
  const englishF = englishFit(profile.englishScore);     // 0..1 or null

  const scored = perCountry.map(({ country, unis }) => {
    const top5 = unis.slice(0, 5);
    const vectorFit = top5.length
      ? top5.reduce((s, u) => s + (u.vecScore || 0), 0) / top5.length
      : 0;
    const preferredFit = preferred.has(country.name.toLowerCase()) ? 1 : 0;
    const budgetF = budgetFit(tuitionMax, country.typicalTuitionUsd);

    // Each factor's points: fit (0..1) × its weight. Missing inputs
    // contribute 0 (the user sees a lower max-possible score, with the
    // "factor missing" chip in the modal explaining why).
    const points = {
      vector:    vectorFit                * WEIGHTS.vector,
      cgpa:      (cgpaF ?? 0)             * WEIGHTS.cgpa,
      budget:    (budgetF ?? 0)           * WEIGHTS.budget,
      preferred: preferredFit             * WEIGHTS.preferred,
      english:   (englishF ?? 0)          * WEIGHTS.english,
    };
    const total = Math.min(100,
      points.vector + points.cgpa + points.budget + points.preferred + points.english
    );

    return {
      country,
      unis,
      score: total / 100,    // keep 0..1 for downstream rounding
      breakdown: points,     // raw points per factor for the chart
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const top3 = scored.slice(0, 3);

  // Build the trimmed candidate payload for the LLM.
  const llmPayload = top3.map(({ country, unis }) => ({
    code: country.code,
    name: country.name,
    universities: unis.slice(0, 5).map(trimUni),
  }));

  let llmResult = null;
  try {
    llmResult = await callGroq(profile, llmPayload);
  } catch (err) {
    console.error("[recommend] Groq call threw", err.message);
  }

  const degraded = llmResult === null;

  // Look up the LLM's reasoning by country code / uni slug. Fall back to
  // templated reasons if missing.
  const llmByCode = new Map();
  if (llmResult) {
    for (const c of llmResult.countries || []) {
      const byUni = new Map();
      for (const u of c.universities || []) byUni.set(u.slug, u.reasons || []);
      llmByCode.set(c.code, { reasons: c.reasons || [], byUni });
    }
  }

  // Compute dataVersion = max meta.updated_at across surviving unis.
  let dataVersion = "";
  for (const { unis } of top3) {
    for (const u of unis) {
      const ts = u.meta?.updated_at;
      if (ts && (!dataVersion || String(ts) > dataVersion)) dataVersion = String(ts);
    }
  }

  // Which profile fields actually influenced this run.
  const factorsUsed = {
    vector: true,
    preferred: (profile.preferredCountries || []).length > 0,
    cgpa: profile.currentCGPA != null,
    budget: profile.tuitionBudgetMax != null,
    english: profile.englishScore != null,
  };

  // Assemble the final payload.
  const countries = top3.map(({ country, unis, score, breakdown }) => {
    const llm = llmByCode.get(country.code);
    const top5Unis = unis.slice(0, 5);

    return {
      code: country.code,
      name: country.name,
      matchScore: Math.round(score * 100),
      typicalTuitionUsd: country.typicalTuitionUsd,
      scoreBreakdown: {
        vector:    Math.round(breakdown.vector),
        cgpa:      Math.round(breakdown.cgpa),
        budget:    Math.round(breakdown.budget),
        preferred: Math.round(breakdown.preferred),
        english:   Math.round(breakdown.english),
      },
      maxPoints: WEIGHTS,
      budgetFit: tuitionMax ? tuitionMax >= country.typicalTuitionUsd : null,
      englishMet: profile.englishScore ? englishOK : null,
      reasons: llm?.reasons?.length ? llm.reasons : templatedReasons(profile, country),
      universities: top5Unis.slice(0, 5).map((u) => ({
        slug: u.slug,
        name: u.name,
        city: u.city || "",
        matchScore: Math.round((u.vecScore || 0) * 100),
        studentsTotal: u.students?.total || null,
        internationalPercent: u.students?.international_percent || null,
        foundedYear: u.founded_year || null,
        reasons: llm?.byUni?.get(u.slug)?.length
          ? llm.byUni.get(u.slug)
          : templatedUniReasons(profile, u),
      })),
    };
  });

  return {
    status: "ok",
    schemaVersion: SCHEMA_VERSION,
    dataVersion,
    profileUpdatedAt: profile.lastProfileUpdatedAt,
    generatedAt: new Date().toISOString(),
    profileCompleteness: completeness,
    degraded,
    factorsUsed,
    countries,
  };
}

// GET / — cache-only read. NEVER triggers Jina or Groq. Returns the cached
// payload if it's still fresh; otherwise returns a status flag so the
// frontend can show a "Generate" button.
router.get("/", auth, async (req, res) => {
  try {
    const profile = await UserProfile.findOne({ userId: req.user.id }).lean();
    if (!profile) {
      return res.status(404).json({
        ok: false,
        status: "needs_profile",
        message: "Create a profile first to get recommendations.",
      });
    }

    const cached = await Recommendation.findOne({ userId: req.user.id }).lean();
    const profileTs = profile.lastProfileUpdatedAt
      ? new Date(profile.lastProfileUpdatedAt).getTime()
      : 0;
    const cachedTs = cached?.profileUpdatedAt
      ? new Date(cached.profileUpdatedAt).getTime()
      : -1;

    if (!cached) {
      console.log(`[recommend] user=${req.user.id} cached=none`);
      return res.json({ ok: true, status: "none" });
    }

    const fresh =
      cached.schemaVersion === SCHEMA_VERSION && cachedTs === profileTs;

    console.log(
      `[recommend] user=${req.user.id} cached=hit fresh=${fresh}`
    );

    // Always return the cached payload so users see their last result
    // even if it's stale. Frontend uses `cacheStatus` to decide whether
    // to show a "Regenerate" prompt.
    return res.json({
      ok: true,
      cacheStatus: fresh ? "fresh" : "stale",
      ...cached.payload,
    });
  } catch (err) {
    console.error("[recommend] error", err.message);
    res.status(500).json({ ok: false, message: "Failed to read recommendations" });
  }
});

// POST /refresh — the ONLY path that hits Jina + Groq. Frontend triggers
// this on explicit user action (button click) to keep API costs predictable.
router.post("/refresh", auth, async (req, res) => {
  try {
    const t0 = Date.now();
    const profile = await UserProfile.findOne({ userId: req.user.id }).lean();
    if (!profile) {
      return res.status(404).json({ ok: false, status: "needs_profile" });
    }
    const payload = await generate(profile);

    if (payload.status === "ok") {
      await Recommendation.findOneAndUpdate(
        { userId: req.user.id },
        {
          $set: {
            profileUpdatedAt: profile.lastProfileUpdatedAt || new Date(),
            schemaVersion: SCHEMA_VERSION,
            dataVersion: payload.dataVersion,
            generatedAt: new Date(),
            payload,
          },
        },
        { upsert: true }
      );
    }

    const top = payload.countries?.[0];
    console.log(
      `[recommend] user=${req.user.id} refresh status=${payload.status} topCountry=${top?.code || "-"} topScore=${top?.matchScore || 0} latencyMs=${Date.now() - t0} degraded=${payload.degraded || false}`
    );

    res.json({ ok: true, cacheStatus: "fresh", ...payload });
  } catch (err) {
    console.error("[recommend] refresh error", err.message);
    res.status(500).json({ ok: false, message: "Failed to refresh recommendations" });
  }
});

module.exports = router;
