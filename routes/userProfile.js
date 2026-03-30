const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const UserProfile = require("../models/userProfile");

router.get("/me", auth, async (req, res) => {
  try {
    const profile = await UserProfile.findOne({ userId: req.user.id });

    if (!profile) {
      return res.status(200).json(null); 
    }

    console.log("Profile found:", profile._id.toString());
    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

router.post("/me", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const allowedFields = [
      "fullName",
      "currentCountry",
      "citizenshipCountry",
      "currentEducationLevel",
      "currentProgram",
      "currentCGPA",
      "yearOfGraduation",
      "targetDegreeLevel",
      "targetFields",
      "intendedIntakeYear",
      "preferredCountries",
      "tuitionBudgetMax",
      "livingBudgetMax",
      "englishTestTaken",
      "englishScore",
      "studyPriorities",
      "profileBio",
    ];

    const updateData = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    updateData.lastProfileUpdatedAt = new Date();

    const profile = await UserProfile.findOneAndUpdate(
      { userId },
      { $set: updateData, $setOnInsert: { userId } },
      {
        new: true,              
        upsert: true,           
        setDefaultsOnInsert: true,
      }
    );

    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: "Failed to save profile" });
  }
});

module.exports = router;
