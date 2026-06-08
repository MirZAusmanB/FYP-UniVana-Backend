const express = require("express");
const University = require("../models/university");
const Program = require("../models/program");
const Country = require("../models/country");
const auth = require("../middleware/auth");

const router = express.Router();

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You are UniVana's university comparison assistant.

STRICT RULES:
1. Compare the two universities using ONLY the CONTEXT below. Do not use general knowledge.
2. Never invent numbers, rankings, fees, or facts not present in the CONTEXT.
3. If the CONTEXT does not contain enough info for a point, omit it rather than guessing.
4. Output ONLY valid JSON with exactly these keys:
{
  "summary": "2-3 sentence neutral overview comparing the two",
  "differences": ["3 to 5 short bullets about meaningful differences"],
  "bestFor": { "a": "one short line on who university A suits", "b": "one short line on who university B suits" }
}
5. Keep every string concise. No markdown, no headings, no extra keys.`;

async function loadUni(idOrSlug) {
  if (!idOrSlug) return null;
  let uni = await University.findById(idOrSlug).lean();
  if (!uni) uni = await University.findOne({ slug: idOrSlug }).lean();
  return uni;
}

function summarizeUni(uni, programs, country) {
  const lines = [];
  lines.push(`Name: ${uni.name}`);
  lines.push(`City: ${uni.city || "N/A"}`);
  lines.push(`Country: ${country?.name || uni.country_id}`);
  if (uni.founded_year) lines.push(`Founded: ${uni.founded_year}`);
  if (uni.students?.total) {
    lines.push(
      `Students: ${uni.students.total}${
        uni.students.international_percent
          ? ` (${uni.students.international_percent}% international)`
          : ""
      }`
    );
  }
  if (uni.application_deadline) {
    lines.push(`Application deadline: ${new Date(uni.application_deadline).toISOString().slice(0, 10)}`);
  }
  if (uni.tags?.length) lines.push(`Tags: ${uni.tags.slice(0, 10).join(", ")}`);
  if (uni.description) lines.push(`About: ${uni.description.slice(0, 500)}`);
  if (country) {
    lines.push(
      `Country info: ${country.name}${country.region ? ` (${country.region})` : ""}${
        country.description ? ` — ${country.description.slice(0, 250)}` : ""
      }`
    );
  }
  if (programs.length) {
    lines.push(`Programs (${programs.length} shown):`);
    programs.forEach((p) => {
      lines.push(
        `  - ${p.name}${p.degree ? ` | ${p.degree}` : ""}${
          p.discipline ? ` | ${p.discipline}` : ""
        }${p.duration ? ` | ${p.duration}` : ""}`
      );
    });
  }
  return lines.join("\n");
}

function fallbackAI() {
  return {
    summary: "AI overview temporarily unavailable. Compare the panels below.",
    differences: [],
    bestFor: { a: "", b: "" },
    degraded: true,
  };
}

async function callGroq(context) {
  const body = {
    model: "llama-3.3-70b-versatile",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `CONTEXT:\n\n${context}\n\nReturn the JSON now.` },
    ],
  };

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Groq error");

  const raw = data.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw);
  if (typeof parsed.summary !== "string") throw new Error("Missing summary");
  if (!Array.isArray(parsed.differences)) parsed.differences = [];
  if (!parsed.bestFor || typeof parsed.bestFor !== "object") {
    parsed.bestFor = { a: "", b: "" };
  }
  return {
    summary: parsed.summary,
    differences: parsed.differences.slice(0, 5).map(String),
    bestFor: {
      a: String(parsed.bestFor.a || ""),
      b: String(parsed.bestFor.b || ""),
    },
    degraded: false,
  };
}

router.post("/", auth, async (req, res) => {
  const t0 = Date.now();
  try {
    const { a, b } = req.body || {};
    if (!a || !b) {
      return res.status(400).json({ ok: false, message: "Both a and b are required" });
    }
    if (a === b) {
      return res.status(400).json({ ok: false, message: "Pick two different universities" });
    }

    const [uniA, uniB] = await Promise.all([loadUni(a), loadUni(b)]);
    if (!uniA || !uniB) {
      return res.status(404).json({ ok: false, message: "University not found" });
    }

    const [programsA, programsB, countryA, countryB] = await Promise.all([
      Program.find({ university_slug: uniA.slug })
        .select("name degree discipline duration study_modes")
        .limit(20)
        .lean(),
      Program.find({ university_slug: uniB.slug })
        .select("name degree discipline duration study_modes")
        .limit(20)
        .lean(),
      Country.findById(uniA.country_id).lean(),
      Country.findById(uniB.country_id).lean(),
    ]);

    const context =
      `UNIVERSITY A:\n${summarizeUni(uniA, programsA, countryA)}\n\n` +
      `UNIVERSITY B:\n${summarizeUni(uniB, programsB, countryB)}`;

    let ai;
    try {
      ai = await callGroq(context);
    } catch (err1) {
      try {
        ai = await callGroq(context);
      } catch (err2) {
        console.error("[compare] Groq failed twice:", err2.message);
        ai = fallbackAI();
      }
    }

    console.log(
      `[compare] a=${uniA.slug} b=${uniB.slug} progA=${programsA.length} progB=${programsB.length} degraded=${ai.degraded} latencyMs=${Date.now() - t0}`
    );

    res.json({
      ok: true,
      a: { ...uniA, programs: programsA, country: countryA || null },
      b: { ...uniB, programs: programsB, country: countryB || null },
      ai,
    });
  } catch (err) {
    console.error("Compare error:", err.message);
    res.status(500).json({ ok: false, message: "Something went wrong" });
  }
});

module.exports = router;
