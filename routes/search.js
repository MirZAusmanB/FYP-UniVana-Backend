const express = require("express");
const Program = require("../models/program");
const University = require("../models/university");
const Country = require("../models/country");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const type = String(req.query.type || "all").toLowerCase();

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 50);
    const skip = (page - 1) * limit;

    if (!q) {
      return res.status(400).json({ ok: false, message: "Search query (q) is required" });
    }

    const textQuery = { $text: { $search: q } };
    const scoreProj = { score: { $meta: "textScore" } };

    // ---------- single-type search ----------
    async function searchSingle(Model, entityName) {
      const [items, total] = await Promise.all([
        Model.find(textQuery, scoreProj)
          .sort({ score: { $meta: "textScore" } })
          .skip(skip)
          .limit(limit)
          .lean(),
        Model.countDocuments(textQuery),
      ]);

      return res.json({
        ok: true,
        query: q,
        type: entityName,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        results: items,
      });
    }

    if (type === "programs") return await searchSingle(Program, "programs");
    if (type === "universities") return await searchSingle(University, "universities");
    if (type === "countries") return await searchSingle(Country, "countries");

    // ---------- type=all (combined + paginated) ----------
    // We'll use aggregation so we can:
    // 1) combine different collections
    // 2) paginate a single unified list
    // 3) still return counts per collection

    const [progCount, uniCount, countryCount] = await Promise.all([
      Program.countDocuments(textQuery),
      University.countDocuments(textQuery),
      Country.countDocuments(textQuery),
    ]);

    // pull some extra for stable fill (optional but helps)
    const perCollectionFetch = Math.min(limit, 20);

    const [progs, unis, countries] = await Promise.all([
      Program.find(textQuery, { ...scoreProj, name: 1, title: 1, degree: 1, discipline: 1, slug: 1, university_slug: 1 })
        .sort({ score: { $meta: "textScore" } })
        .limit(perCollectionFetch)
        .lean(),

      University.find(textQuery, { ...scoreProj, name: 1, slug: 1, city: 1, country_id: 1, website: 1 })
        .sort({ score: { $meta: "textScore" } })
        .limit(perCollectionFetch)
        .lean(),

      Country.find(textQuery, { ...scoreProj, name: 1, slug: 1, region: 1 })
        .sort({ score: { $meta: "textScore" } })
        .limit(Math.min(10, perCollectionFetch))
        .lean(),
    ]);

    // tag each result with entity type so frontend can render properly
    const combined = [
      ...progs.map((x) => ({ ...x, entity: "program" })),
      ...unis.map((x) => ({ ...x, entity: "university" })),
      ...countries.map((x) => ({ ...x, entity: "country" })),
    ].sort((a, b) => (b.score || 0) - (a.score || 0));

    const totalAll = progCount + uniCount + countryCount;

    const paged = combined.slice(skip, skip + limit);

    return res.json({
      ok: true,
      query: q,
      type: "all",
      page,
      limit,
      total: totalAll,
      totalPages: Math.ceil(totalAll / limit),
      counts: {
        programs: progCount,
        universities: uniCount,
        countries: countryCount,
      },
      results: paged,
    });
  } catch (err) {
    console.error("Global Search Error:", err);
    return res.status(500).json({ ok: false, message: "Internal server error" });
  }
});

module.exports = router;
