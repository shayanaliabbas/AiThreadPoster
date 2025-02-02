require('dotenv').config();
const { AIThreadsPoster } = require('./ai-thread-poster');

const poster = new AIThreadsPoster();
poster.startScheduler();
