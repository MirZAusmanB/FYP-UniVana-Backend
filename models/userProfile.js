const mongoose = require("mongoose");

const userProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    fullName: { type: String, default: "" },
    currentCountry: { type: String, default: "" },
    citizenshipCountry: { type: String, default: "" },

    currentEducationLevel: { type: String, default: "" },
    currentProgram: { type: String, default: "" },
    currentCGPA: { type: Number, default: null },
    yearOfGraduation: { type: Number, default: null },

    targetDegreeLevel: { type: String, default: "" },
    targetFields: { type: [String], default: [] },
    intendedIntakeYear: { type: Number, default: null },
    preferredCountries: { type: [String], default: [] },

    tuitionBudgetMax: { type: Number, default: null },
    livingBudgetMax: { type: Number, default: null },

    englishTestTaken: { type: String, default: "" },
    englishScore: { type: Number, default: null },

    studyPriorities: { type: [String], default: [] },
    profileBio: { type: String, default: "" },

    lastProfileUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserProfile", userProfileSchema);
