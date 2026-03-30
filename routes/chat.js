const express = require("express");
const jwt = require("jsonwebtoken");
const University = require("../models/university");
const Program = require("../models/program");
const Country = require("../models/country");
const ChatHistory = require("../models/chatHistory");
const auth = require("../middleware/auth");

const router = express.Router();

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You are UniVana Assistant, a helpful chatbot for UniVana — a study abroad university discovery platform focused on European universities.

You help users find universities, programs, and countries for studying abroad in Europe.

RULES:
1. Use the DATABASE CONTEXT provided below to answer questions. Be specific — mention university names, program details, cities, etc.
2. If the database context is empty or doesn't contain relevant information, you can still help with general study abroad advice, but clearly say "Based on my general knowledge" to distinguish from database-backed answers.
3. Keep responses concise (2-4 sentences for simple questions, more for detailed ones).
4. Be friendly and encouraging about studying abroad.
5. If asked about something completely unrelated to education/universities, politely redirect to study abroad topics.`;

// Country name → database identifiers mapping
const COUNTRIES = {
  france:  { slug: "france",  iso2: "FR" },
  germany: { slug: "germany", iso2: "DE" },
  italy:   { slug: "italy",   iso2: "IT" },
  norway:  { slug: "norway",  iso2: "NO" },
  sweden:  { slug: "sweden",  iso2: "SE" },
};

// Checks if the user's message mentions a country name
function detectCountry(message) {
  const lower = message.toLowerCase();
  for (const [name, data] of Object.entries(COUNTRIES)) {
    if (lower.includes(name)) return data;
  }
  return null;
}

// Soft auth — tries to authenticate but doesn't block if no token
function softAuth(req, res, next) {
  const token = req.cookies?.univanaAuthToken;
  if (!token) return next();
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    // ignore invalid token
  }
  next();
}

// GET / — load chat history (requires login)
router.get("/", auth, async (req, res) => {
  try {
    const history = await ChatHistory.findOne({ userId: req.user.id }).lean();
    res.json({ ok: true, messages: history?.messages || [] });
  } catch (err) {
    console.error("Chat history load error:", err.message);
    res.status(500).json({ ok: false, message: "Failed to load chat history" });
  }
});

// POST / — send a message and get AI reply
router.post("/", softAuth, async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();
    const history = Array.isArray(req.body.history) ? req.body.history : [];

    if (!message) {
      return res.status(400).json({ ok: false, message: "Message is required" });
    }

    // 1. Search the database for relevant context
    const textQuery = { $text: { $search: message } };
    const detected = detectCountry(message);

    // Build a regex from the longer words in the message (3+ chars) for name matching
    const keywords = message
      .replace(/[^a-zA-Z ]/g, "")
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    const nameRegex = keywords.length
      ? new RegExp(keywords.join("|"), "i")
      : null;

    // Country filter: include docs where country matches OR country is missing
    const uniQuery = detected
      ? { ...textQuery, country_id: detected.iso2 }
      : textQuery;
    const progQuery = detected
      ? { ...textQuery, country: { $in: [detected.slug, null, undefined] } }
      : textQuery;
    const countryQuery = detected
      ? { ...textQuery, _id: detected.iso2 }
      : textQuery;

    // Run text search + regex name search in parallel
    const [universities, textPrograms, namePrograms, countries] = await Promise.all([
      University.find(uniQuery, { score: { $meta: "textScore" } })
        .sort({ score: { $meta: "textScore" } })
        .limit(10)
        .lean(),
      Program.find(progQuery, { score: { $meta: "textScore" } })
        .sort({ score: { $meta: "textScore" } })
        .limit(20)
        .lean(),
      nameRegex
        ? Program.find(
            detected
              ? { name: nameRegex, country: { $in: [detected.slug, null, undefined] } }
              : { name: nameRegex }
          )
            .limit(10)
            .lean()
        : Promise.resolve([]),
      Country.find(countryQuery, { score: { $meta: "textScore" } })
        .sort({ score: { $meta: "textScore" } })
        .limit(5)
        .lean(),
    ]);

    // Merge text search and name search results, removing duplicates
    const seenIds = new Set(textPrograms.map((p) => p._id.toString()));
    const extraPrograms = namePrograms.filter((p) => !seenIds.has(p._id.toString()));
    const programs = [...textPrograms, ...extraPrograms];

    // 2. Format database results into a readable context string
    let context = "";

    if (universities.length) {
      context += "UNIVERSITIES:\n";
      universities.forEach((u) => {
        context += `- ${u.name} | City: ${u.city || "N/A"} | Country: ${u.country_id} | Founded: ${u.founded_year || "N/A"} | Students: ${u.students?.total || "N/A"} (${u.students?.international_percent || "N/A"}% international)\n`;
      });
    }

    if (programs.length) {
      context += "\nPROGRAMS:\n";
      programs.forEach((p) => {
        context += `- ${p.name} | Degree: ${p.degree || "N/A"} | Discipline: ${p.discipline || "N/A"} | Duration: ${p.duration || "N/A"} | University: ${p.university_slug || "N/A"}\n`;
      });
    }

    if (countries.length) {
      context += "\nCOUNTRIES:\n";
      countries.forEach((c) => {
        context += `- ${c.name} | Region: ${c.region || "N/A"} | ${(c.description || "").slice(0, 200)}\n`;
      });
    }

    if (!context) {
      context = "No matching results found in the database for this query.";
    }

    // 3. Build the conversation messages for Groq
    const recentHistory = history.slice(-6);
    const groqMessages = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\nDATABASE CONTEXT:\n${context}` },
      ...recentHistory.map((msg) => ({ role: msg.role, content: msg.content })),
      { role: "user", content: message },
    ];

    // 4. Call Groq API
    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: groqMessages,
      }),
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      console.error("Groq API error:", data);
      return res.status(500).json({ ok: false, message: "AI service error" });
    }

    const reply = data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";

    // 5. Save to chat history if user is logged in
    if (req.user) {
      await ChatHistory.findOneAndUpdate(
        { userId: req.user.id },
        {
          $push: {
            messages: {
              $each: [
                { role: "user", content: message },
                { role: "assistant", content: reply },
              ],
            },
          },
        },
        { upsert: true }
      );
    }

    res.json({ ok: true, reply });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ ok: false, message: "Something went wrong" });
  }
});

module.exports = router;
