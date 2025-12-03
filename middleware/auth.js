const jwt = require("jsonwebtoken");

function auth(req, res, next){
    const token = req.cookies?.univanaAuthToken

    if (!token) {
        return res.status(400).json({message: "Not Authenticated"})
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        req.user = decoded
        next()
    } catch (error) {
        return res.status(401).json({message: error.message})
    }
}

module.exports = auth;