const mongoose = require('mongoose');

const PlayerResultSchema = new mongoose.Schema({
    name: { type: String, required: true },
    score: { type: Number, default: 0 },
});

const GameResultSchema = new mongoose.Schema({
    quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz' },
    pin: { type: String, required: true },
    players: [PlayerResultSchema],
    playedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('GameResult', GameResultSchema);
