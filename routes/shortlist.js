const express = require("express");
const Shortlist = require("../models/shortlist");
const requireAuth = require("../middleware/auth");

const router = express.Router();

// ✅ Enable auth (otherwise req.user will be undefined)
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const items = await Shortlist.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ ok: true, items });
  } catch (err) {
    res.status(500).json({ ok: false, message: "Failed to fetch shortlist" });
  }
});

router.post("/toggle", async (req, res) => {
  try {
    const { itemType, itemKey, Name = "", city = "", uniName = "" } = req.body;

    if (!itemType || !itemKey) {
      return res
        .status(400)
        .json({ message: "itemType and itemKey are required" });
    }

    if (!["university", "program"].includes(itemType)) {
      return res.status(400).json({ message: "Invalid itemType" });
    }

    const exists = await Shortlist.findOne({
      userId: req.user.id, 
      itemType,
      itemKey,
    });

    if (exists) {
      await Shortlist.deleteOne({ _id: exists._id });
      return res.json({ ok: true, saved: false });
    }

    await Shortlist.create({
      userId: req.user.id,
      itemType,
      itemKey,
      Name,
      city,
      uniName
    });

    return res.json({ ok: true, saved: true });
  } catch (err) {
    if (err.code === 11000) return res.json({ ok: true, saved: true });
    res.status(500).json({ ok: false, message: "Failed to toggle shortlist" });
  }
});

router.get("/check", async (req, res) => {
  try {
    const { itemType, itemKey } = req.query;

    if (!itemType || !itemKey) {
      return res.status(400).json({ message: "itemType and itemKey are required" });
    }

    const exists = await Shortlist.exists({
      userId: req.user.id,
      itemType,
      itemKey,
    });

    res.json({ ok: true, saved: !!exists });
  } catch (err) {
    res.status(500).json({ message: "Failed to check item" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await Shortlist.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: "Failed to remove item" });
  }
});

router.delete("/", async (req, res) => {
  try {
    await Shortlist.deleteMany({ userId: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: "Failed to clear shortlist" });
  }
});

module.exports = router;
