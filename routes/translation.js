const express = require("express");
const axios = require("axios");

const router = express.Router();

router.post("/translate", async (req, res) => {
  try {
    const { text, targetLang } = req.body;

    if (!text || !targetLang) {
      return res.status(400).json({ message: "Text and target language are required" });
    }

    if (targetLang === "en") {
      return res.json({ translatedText: text });
    }

    const response = await axios.get("https://api.mymemory.translated.net/get", {
      params: {
        q: text,
        langpair: `en|${targetLang}`,
      },
    });

    return res.json({
      translatedText: response.data.responseData.translatedText,
    });
  } catch (error) {
    console.log("Translation Error:", error.response?.data || error.message);

    return res.status(500).json({
      message: "Translation failed",
      error: error.response?.data || error.message,
    });
  }
});

module.exports = router;

