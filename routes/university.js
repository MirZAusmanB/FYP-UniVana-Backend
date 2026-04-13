const express = require('express');
const router = express.Router()
const university = require('../models/university')


router.get('/', async (req, res) =>{
    try {
        const doc = await university.find()
        const count = await university.countDocuments()
        res.status(200).json({
            doc,
            count
        })
    } catch (error) {
        res.status(500).json({message: error.message})
    }
})

router.get('/id/:id', async (req, res) =>{
    try {
        const doc  = await university.findById(req.params.id)
        if (doc == null){
            return res.status(404).json({message : 'university not found!!'})
        }
        res.status(200).json({
            doc
        })
    } catch (error) {
        res.status(500).json({message: error.message})
    }
})

// Set or update application deadline for a university
router.put('/id/:id/deadline', async (req, res) => {
    try {
        const { application_deadline } = req.body;
        if (!application_deadline) {
            return res.status(400).json({ message: 'application_deadline is required (YYYY-MM-DD)' });
        }

        const date = new Date(application_deadline);
        if (isNaN(date.getTime())) {
            return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
        }

        const doc = await university.findByIdAndUpdate(
            req.params.id,
            { application_deadline: date },
            { new: true }
        );

        if (!doc) {
            return res.status(404).json({ message: 'University not found' });
        }

        res.json({ message: 'Deadline updated', doc });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get('/country/:country_id', async (req, res) =>{
    try {
        const doc = await university.find({country_id: req.params.country_id}).select('name')
        const count = doc.length
        if (count === 0){
        return res.status(404).json({message: `university of this country ${country_id} not found`})
        }
        res.status(200).json({
            doc,
            count
        })
    } catch (error) {
        res.status(500).json({message: error.message})
    }
})


module.exports = router