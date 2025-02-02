require('dotenv').config();
const { ThreadsAPI } = require('threads-api');
const schedule = require('node-schedule');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

class AIThreadsPoster {
  constructor() {
    // Initialize class properties
    this.topics = [
      'artificial intelligence trends',
      'machine learning breakthroughs',
      'deep learning applications',
      'AI ethics and responsibility',
      'AI in healthcare',
      'AI in business',
      'neural networks explained',
      'computer vision advances',
      'natural language processing',
      'robotics and AI',
      'AI and cybersecurity',
      'AI in education'
    ];

    this.retryAttempts = 3;
    this.retryDelay = 5000; // 5 seconds
    this.postInterval = 3000; // 3 seconds between posts
    this.imageTimeout = 5000; // 5 seconds for image fetching

    // Initialize APIs
    this.initializeAPIs();
  }

  async initializeAPIs() {
    try {
      // Validate environment variables first
      this.validateEnvironment();

      // Initialize ThreadsAPI
      this.threadsAPI = new ThreadsAPI({
        username: process.env.THREADS_USERNAME,
        password: process.env.THREADS_PASSWORD,
        deviceID: process.env.THREADS_DEVICE_ID
      });

      // Initialize Gemini
      this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.model = this.genAI.getGenerativeModel({ model: "gemini-pro" });

      console.log('APIs initialized successfully');
    } catch (error) {
      console.error('Error initializing APIs:', error);
      process.exit(1);
    }
  }

  validateEnvironment() {
    const requiredEnvVars = [
      'THREADS_USERNAME',
      'THREADS_PASSWORD',
      'THREADS_DEVICE_ID',
      'GEMINI_API_KEY'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
  }

  async generateContent(retryCount = 0) {
    try {
      const randomTopic = this.topics[Math.floor(Math.random() * this.topics.length)];
      console.log(`Generating content about: ${randomTopic}`);

      const prompt = `Create an engaging and informative thread about ${randomTopic}.
        Requirements:
        - Focus on recent developments and interesting facts
        - Create 3-4 separate posts
        - Each post should be under 280 characters
        - Use emojis appropriately
        - Include relevant hashtags in each post
        - Make content engaging and educational
        - Ensure posts flow naturally from one to another
        - Include latest developments from 2024`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const posts = text.split('\n\n')
        .filter(post => post.trim() !== '')
        .map(post => post.trim())
        .filter(post => post.length <= 280);

      if (posts.length === 0) {
        throw new Error('No valid posts generated');
      }

      return posts;

    } catch (error) {
      console.error('Error generating content:', error);
      
      if (retryCount < this.retryAttempts) {
        console.log(`Retrying content generation (attempt ${retryCount + 1}/${this.retryAttempts})`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        return this.generateContent(retryCount + 1);
      }

      // Return fallback content if all retries fail
      return this.getFallbackContent();
    }
  }

  getFallbackContent() {
    const topic = this.topics[Math.floor(Math.random() * this.topics.length)];
    return [
      `🤖 Exploring the fascinating world of ${topic}! The latest developments are revolutionizing how we approach technology. #AI #Innovation`,
      '💡 From improved accuracy to enhanced efficiency, these advancements are reshaping industries worldwide. #Technology #Future',
      '🔮 Stay tuned as we continue to witness groundbreaking developments in this exciting field! #TechTrends #AIFuture'
    ];
  }

  async getRelevantImage(topic, retryCount = 0) {
    try {
      const searchTerm = `${topic} technology visualization`;
      const imageUrl = `https://source.unsplash.com/featured/1024x1024/?${encodeURIComponent(searchTerm)}`;
      
      const response = await axios.get(imageUrl, {
        timeout: this.imageTimeout,
        validateStatus: status => status === 200,
        maxRedirects: 5
      });

      return response.request.res.responseUrl;

    } catch (error) {
      console.error('Error fetching image:', error);
      
      if (retryCount < this.retryAttempts) {
        console.log(`Retrying image fetch (attempt ${retryCount + 1}/${this.retryAttempts})`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        return this.getRelevantImage(topic, retryCount + 1);
      }

      // Return fallback image if all retries fail
      return 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485';
    }
  }

  async postThread() {
    try {
      console.log('Starting new thread posting process...');
      const posts = await this.generateContent();
      let previousPostId = null;

      for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        console.log(`\nPosting ${i + 1}/${posts.length}:`);
        console.log(`Content preview: ${post.substring(0, 50)}...`);

        try {
          // First try posting without image
          const threadPost = await this.threadsAPI.publish({
            text: post,
            replyToPostId: previousPostId
          });

          previousPostId = threadPost.id;
          console.log(`Successfully posted text for part ${i + 1}`);

          // Then try adding image separately
          try {
            const imageUrl = await this.getRelevantImage(post.substring(0, 50));
            console.log('Image URL obtained:', imageUrl);

            if (imageUrl) {
              const imageResponse = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: this.imageTimeout,
                validateStatus: (status) => status === 200
              });

              if (imageResponse.data) {
                const imageBuffer = Buffer.from(imageResponse.data, 'binary');
                
                // Post image as a reply
                await this.threadsAPI.publish({
                  text: '🖼️',  // Image emoji as caption
                  replyToPostId: threadPost.id,
                  image: imageBuffer
                });
                
                console.log(`Successfully added image to part ${i + 1}`);
              }
            }
          } catch (imageError) {
            console.error(`Failed to add image to part ${i + 1}:`, imageError.message);
            // Continue without image
          }

          // Wait between posts
          if (i < posts.length - 1) {
            console.log(`Waiting ${this.postInterval}ms before next post...`);
            await new Promise(resolve => setTimeout(resolve, this.postInterval));
          }

        } catch (postError) {
          console.error(`Error posting part ${i + 1}:`, postError.message);
          if (i === 0) {
            // If first post fails, abort the thread
            throw new Error('Failed to create thread');
          }
          // For subsequent posts, continue with next post
          continue;
        }
      }

      console.log('\nThread posting completed successfully!');
    } catch (error) {
      console.error('Error in thread posting process:', error.message);
    }
  }

  startScheduler() {
    console.log('Starting scheduler...');
    
    // Post immediately on start
    console.log('Making initial post...');
    this.postThread().catch(console.error);
    
    // Schedule posts every 6 hours
    const job = schedule.scheduleJob('0 */6 * * *', async () => {
      console.log(`\nStarting scheduled post at ${new Date().toISOString()}`);
      await this.postThread();
    });

    console.log('Scheduler started successfully');
    console.log('Next post scheduled for:', job.nextInvocation().toString());
    
    return job;
  }
}

module.exports = { AIThreadsPoster };
