const express = require('express');
const router = express.Router();
const countryDetail = require('../models/countryDetail');


router.get('/:id', async (req, res) => {
  try {
    const id = String(req.params.id).trim().toUpperCase();  // normalize
    const doc = await countryDetail.findById(id);
    if (!doc) return res.status(404).json({ message: `Country detail not found for _id=${id}` });
    res.status(200).json({ doc });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


module.exports = router;
