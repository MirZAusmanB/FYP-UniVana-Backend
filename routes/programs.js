const express = require('express');
const Program = require('../models/program'); // (optional) PascalCase for models
const router = express.Router();

router.get('/id/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const programDoc = await Program.findById(id);
    if (!programDoc) {
      return res.status(404).json({ message: 'Program not found' });
    }
    res.status(200).json({ doc: programDoc });
  } catch (error) {
    console.error('Error fetching program by ID:', error);
    res.status(500).json({ message: error.message });
  }
});


router.get('/:uni/bachelors', async (req, res) => {
  try {
    const bachelorsPrograms = await Program.find({
      university_slug: req.params.uni,
      degree: { $regex: 'Bachelor', $options: 'i' },
    }).select('name -_id');

    const names = bachelorsPrograms.map(p => p.name);
    res.status(200).json({ names, count: names.length });
  } catch (error) {
    console.error("Error fetching Bachelor's programs:", error);
    res.status(500).json({ message: error.message });
  }
});

router.get('/:uni/masters', async (req, res) => {
  try {
    const mastersPrograms = await Program.find({
      university_slug: req.params.uni,
      degree: { $regex: 'Master', $options: 'i' },
    }).select('name -_id');

    const names = mastersPrograms.map(p => p.name);
    res.status(200).json({ names, count: names.length });
  } catch (error) {
    console.error("Error fetching Master's programs:", error);
    res.status(500).json({ message: error.message });
  }
});


router.get('/:university_slug/programs/:program_slug', async (req, res) => {
  try {
    const { university_slug, program_slug } = req.params;

    const programDoc = await Program.findOne({
      university_slug,
      slug: program_slug, 
    });

    if (!programDoc) {
      return res.status(404).json({ message: 'Program not found' });
    }

    res.status(200).json({ doc: programDoc });
  } catch (error) {
    console.error('Error fetching single program by slug:', error);
    res.status(500).json({ message: error.message });
  }
});


router.get('/:uni', async (req, res) => {
  try {
    const docs = await Program.find({ university_slug: req.params.uni });
    res.status(200).json({ doc: docs, count: docs.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
