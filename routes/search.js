const express = require("express");
const Program = require("../models/program");
const University = require("../models/university");
const Country = require("../models/country");

const router = express.Router();

// small helper
const asStr = (v) => String(v ?? "").trim();
const asNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

router.get("/", async (req, res) => {
  try {
    const q = asStr(req.query.q);
    const type = asStr(req.query.type || "all").toLowerCase();

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 50);
    const skip = (page - 1) * limit;

    // -------- filters (optional) --------
    const country = asStr(req.query.country).toUpperCase(); // e.g. "DE"
    const degree = asStr(req.query.degree);                 // e.g. "Bachelor"
    const discipline = asStr(req.query.discipline);         // e.g. "Computer"
    const city = asStr(req.query.city);                     // e.g. "Berlin"
    const studyMode = asStr(req.query.studyMode);           // if exists
    const tuitionMax = asNum(req.query.tuitionMax);         // if exists

    if (!q) {
      return res.status(400).json({ ok: false, message: "Search query (q) is required" });
    }

    const textMatch = { $text: { $search: q } };

    // Build per-collection match objects
    const programMatch = {
      ...textMatch,
      ...(degree ? { degree: { $regex: degree, $options: "i" } } : {}),
      ...(discipline ? { discipline: { $regex: discipline, $options: "i" } } : {}),
      ...(studyMode ? { studyMode: { $regex: studyMode, $options: "i" } } : {}),
      ...(country ? { country_id: country } : {}),
      ...(tuitionMax != null ? { tuition: { $lte: tuitionMax } } : {}),
    };

    const universityMatch = {
      ...textMatch,
      ...(country ? { country_id: country } : {}),
      ...(city ? { city: { $regex: city, $options: "i" } } : {}),
      ...(studyMode ? { studyMode: { $regex: studyMode, $options: "i" } } : {}),
      ...(tuitionMax != null ? { tuition: { $lte: tuitionMax } } : {}),
    };

    const countryMatch = {
      ...textMatch,
      ...(country ? { _id: country } : {}),
    };

    // -------------------------
    // type=programs (FIXED)
    // now includes university_id (University._id) via lookup on university_slug -> University.slug
    // -------------------------
    if (type === "programs") {
      const pipeline = [
        { $match: programMatch },
        { $addFields: { score: { $meta: "textScore" }, entity: "program" } },

        {
          $lookup: {
            from: University.collection.name,
            localField: "university_slug",
            foreignField: "slug",
            as: "uni",
          },
        },
        { $unwind: { path: "$uni", preserveNullAndEmptyArrays: true } },

        {
          $project: {
            _id: 1,
            entity: 1,
            score: 1,
            name: 1,
            title: 1,
            degree: 1,
            discipline: 1,
            slug: 1,
            university_slug: 1,
            country_id: 1,

            // ✅ REQUIRED for frontend routing:
            // /universities/id/:universityId/programs/:programSlug
            university_id: "$uni._id",
          },
        },

        { $sort: { score: -1 } },
        { $skip: skip },
        { $limit: limit },
      ];

      const [items, total] = await Promise.all([
        Program.aggregate(pipeline),
        Program.countDocuments(programMatch),
      ]);

      return res.json({
        ok: true,
        query: q,
        type: "programs",
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        results: items,
      });
    }

    // -------------------------
    // type=universities
    // -------------------------
    if (type === "universities") {
      const [items, total] = await Promise.all([
        University.find(
          universityMatch,
          { name: 1, slug: 1, city: 1, country_id: 1, website: 1, tags: 1, score: { $meta: "textScore" } }
        )
          .sort({ score: { $meta: "textScore" } })
          .skip(skip)
          .limit(limit)
          .lean(),
        University.countDocuments(universityMatch),
      ]);

      return res.json({
        ok: true,
        query: q,
        type: "universities",
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        results: items.map((x) => ({ ...x, entity: "university" })),
      });
    }

    // -------------------------
    // type=countries
    // -------------------------
    if (type === "countries") {
      const [items, total] = await Promise.all([
        Country.find(
          countryMatch,
          { name: 1, slug: 1, region: 1, description: 1, score: { $meta: "textScore" } }
        )
          .sort({ score: { $meta: "textScore" } })
          .skip(skip)
          .limit(limit)
          .lean(),
        Country.countDocuments(countryMatch),
      ]);

      return res.json({
        ok: true,
        query: q,
        type: "countries",
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        results: items.map((x) => ({ ...x, entity: "country" })),
      });
    }

    // -------------------------
    // type=all (FIXED)
    // unified pagination across collections using $unionWith
    // programs section now includes university_id
    // -------------------------
    const [progCount, uniCount, countryCount] = await Promise.all([
      Program.countDocuments(programMatch),
      University.countDocuments(universityMatch),
      Country.countDocuments(countryMatch),
    ]);

    const pipeline = [
      // Programs
      { $match: programMatch },
      { $addFields: { score: { $meta: "textScore" }, entity: "program" } },

      {
        $lookup: {
          from: University.collection.name,
          localField: "university_slug",
          foreignField: "slug",
          as: "uni",
        },
      },
      { $unwind: { path: "$uni", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          _id: 1,
          entity: 1,
          score: 1,
          name: 1,
          title: 1,
          degree: 1,
          discipline: 1,
          slug: 1,
          university_slug: 1,
          country_id: 1,

          // ✅ for frontend program-detail routing
          university_id: "$uni._id",
        },
      },

      // Universities
      {
        $unionWith: {
          coll: University.collection.name,
          pipeline: [
            { $match: universityMatch },
            { $addFields: { score: { $meta: "textScore" }, entity: "university" } },
            {
              $project: {
                _id: 1,
                entity: 1,
                score: 1,
                name: 1,
                slug: 1,
                city: 1,
                country_id: 1,
                website: 1,
                tags: 1,
              },
            },
          ],
        },
      },

      // Countries
      {
        $unionWith: {
          coll: Country.collection.name,
          pipeline: [
            { $match: countryMatch },
            { $addFields: { score: { $meta: "textScore" }, entity: "country" } },
            {
              $project: {
                _id: 1,
                entity: 1,
                score: 1,
                name: 1,
                slug: 1,
                region: 1,
                description: 1,
              },
            },
          ],
        },
      },

      { $sort: { score: -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    const results = await Program.aggregate(pipeline);
    const totalAll = progCount + uniCount + countryCount;

    return res.json({
      ok: true,
      query: q,
      type: "all",
      page,
      limit,
      total: totalAll,
      totalPages: Math.max(1, Math.ceil(totalAll / limit)),
      counts: {
        programs: progCount,
        universities: uniCount,
        countries: countryCount,
      },
      results,
    });
  } catch (err) {
    console.error("Global Search Error:", err);
    return res.status(500).json({ ok: false, message: "Internal server error" });
  }
});

module.exports = router;
