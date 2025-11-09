require('dotenv').config()
const express = require('express')
const mongoose = require('mongoose')
const cors = require("cors");
const countriesRouter = require('./routes/country');
const universityRouter = require('./routes/university');
const programRouter = require('./routes/programs')
const countryDetailRouter = require('./routes/countryDetail');
const authRouter = require('./routes/auth');

const app = express()
const PORT = 4000;

app.use(cors({
    origin: "http://localhost:3000", 
}))

mongoose.connect(process.env.CONNECTION_STRING)
const db = mongoose.connection

db.on('error',(error) =>{
    console.log(error)
} )
db.once('open', () =>{
    console.log('✅ Connected to MongoDB')
})

app.use(express.json())

app.use('/countries', countriesRouter)
app.use('/universities', universityRouter)
app.use('/programs', programRouter)
app.use('/countrydetails', countryDetailRouter)
app.use("/auth", authRouter);


app.listen(PORT, () => {
    console.log(`Server Started at Port ${PORT}`)
})