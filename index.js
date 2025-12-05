const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const Quiz = require('./models/Quiz');
const GameResult = require('./models/GameResult');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

mongoose.connect('mongodb://localhost:27017/kahoot-clone')
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log(err));

// Routes
app.post('/api/quizzes', async (req, res) => {
    try {
        const quiz = new Quiz(req.body);
        await quiz.save();
        res.status(201).json(quiz);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/quizzes', async (req, res) => {
    try {
        const quizzes = await Quiz.find();
        res.json(quizzes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/quizzes/:id', async (req, res) => {
    try {
        const quiz = await Quiz.findById(req.params.id);
        res.json(quiz);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Game State Management
const games = {};

async function sendQuestion(pin) {
    const game = games[pin];
    if (!game) return;

    if (!game.quizData) {
        game.quizData = await Quiz.findById(game.quizId);
    }

    const question = game.quizData.questions[game.currentQuestionIndex];

    if (question) {
        game.questionStartTime = Date.now();
        game.fastestCorrectAnswer = null;

        io.to(pin).emit('new-question', {
            questionText: question.questionText,
            options: question.options,
            timeLimit: question.timeLimit,
            qIndex: game.currentQuestionIndex,
            totalQuestions: game.quizData.questions.length
        });

        let timeLeft = question.timeLimit;
        // Clear existing timer if any
        if (game.timer) clearInterval(game.timer);

        game.timer = setInterval(() => {
            timeLeft--;
            io.to(pin).emit('timer-tick', timeLeft);
            if (timeLeft <= 0) {
                clearInterval(game.timer);
                io.to(pin).emit('question-ended', { fastestCorrectAnswer: game.fastestCorrectAnswer });
            }
        }, 1000);
    } else {
        // Game Over
        io.to(pin).emit('game-over', game.players);

        const result = new GameResult({
            quizId: game.quizId,
            pin: pin,
            players: game.players
        });
        await result.save();

        if (game.timer) clearInterval(game.timer);
        delete games[pin];
    }
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('host-create-game', async (quizId) => {
        const pin = Math.floor(100000 + Math.random() * 900000).toString();
        games[pin] = {
            quizId,
            hostId: socket.id,
            players: [],
            currentQuestionIndex: -1,
            isLive: false,
            quizData: null,
            questionStartTime: 0,
            fastestCorrectAnswer: null
        };
        socket.join(pin);
        socket.emit('game-created', pin);
        console.log(`Game created with PIN: ${pin}`);
    });

    socket.on('player-join', ({ pin, name }) => {
        const game = games[pin];
        if (game) {
            const player = { id: socket.id, name, score: 0 };
            game.players.push(player);
            socket.join(pin);
            io.to(game.hostId).emit('player-joined', player);
            socket.emit('join-success', { name, pin });
        } else {
            socket.emit('error', 'Game not found');
        }
    });

    socket.on('host-start-game', (pin) => {
        const game = games[pin];
        if (game && game.hostId === socket.id) {
            game.isLive = true;
            game.currentQuestionIndex = 0;
            io.to(pin).emit('game-started');
            sendQuestion(pin);
        }
    });

    socket.on('player-answer', ({ pin, answerIndex }) => {
        const game = games[pin];
        if (game && game.isLive && game.quizData) {
            const question = game.quizData.questions[game.currentQuestionIndex];
            // Prevent multiple answers? For now, just take the last one or first one. 
            // Ideally we should track if player answered this question already.

            const isCorrect = question.correctOptionIndex === answerIndex;
            const player = game.players.find(p => p.id === socket.id);

            if (player) {
                if (isCorrect) {
                    player.score += 100;

                    const timeTaken = (Date.now() - game.questionStartTime) / 1000;
                    if (!game.fastestCorrectAnswer || timeTaken < game.fastestCorrectAnswer.rawTime) {
                        game.fastestCorrectAnswer = {
                            name: player.name,
                            time: timeTaken.toFixed(2),
                            rawTime: timeTaken
                        };
                    }
                }
                io.to(game.hostId).emit('player-answered', { playerId: socket.id });
            }
        }
    });

    socket.on('host-next-question', (pin) => {
        const game = games[pin];
        if (game && game.hostId === socket.id) {
            game.currentQuestionIndex++;
            sendQuestion(pin);
        }
    });
});

const PORT = 5001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
