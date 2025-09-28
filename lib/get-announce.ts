import { WhopServerSdk } from "@whop/api";

const whopSdk = WhopServerSdk({
  // This is the appId of your app. You can find this in the "App Settings" section of your app's Whop dashboard.
  // This is required.
  appId: 'app_1fjbYSzKaUwexe',

  // Add your app api key here - this is required.
  // You can get this from the Whop dashboard after creating an app in the "API Keys" section.
  appApiKey: '5q8elZZ8SmvWJYYEQSWZ-QKZfbXFRBBpMx-izdCgqFc',

  // This will make api requests on behalf of this user.
  // This is optional, however most api requests need to be made on behalf of a user.
  // You can create an agent user for your app, and use their userId here.
  // You can also apply a different userId later with the `withUser` function.
  onBehalfOfUserId: 'user_WRcmbDKkbMpLB',

  // This is the companyId that will be used for the api requests.
  // When making api requests that query or mutate data about a company, you need to specify the companyId.
  // This is optional, however if not specified certain requests will fail.
  // This can also be applied later with the `withCompany` function.
  companyId: 'biz_OYXRzWXqdSOH9g',
});

async function fetchAnnouncements(experienceId: string) {
  try {
    console.log(`Fetching announcements from experience: ${experienceId}`);
    
    // Use the agent user ID 
    const userId = 'user_WRcmbDKkbMpLB';
    
    if (!userId) {
      console.error("ERROR: No agent user ID found in environment variables");
      return;
    }
    
    // Fetch posts from the forum
    const postsResult = await whopSdk.listForumPostsFromForum({
      experienceId: experienceId,
    });
    
    // Get posts from the nested structure
    const posts = postsResult?.feedPosts?.posts || [];
    
    if (!posts || posts.length === 0) {
      console.log("No posts found in this forum.");
      return null;
    }
    
    console.log(`\n===== FOUND ${posts.length} POSTS =====\n`);
    
    // Display posts in terminal
    posts.forEach((post, index) => {
      console.log(`\n----- POST ${index + 1} -----`);
      console.log(`Author: ${post.user.name} (@${post.user.username})`);
      console.log(`Status: ${post.isPinned ? "📌 PINNED" : ""} ${post.isEdited ? "✏️ EDITED" : ""}`);
      console.log(`Created: ${new Date(parseInt(post.createdAt)).toLocaleString()}`);
      console.log(`\nContent:\n${post.content}\n`);
      console.log("-".repeat(30));
    });
    
    console.log("\n===== END OF ANNOUNCEMENTS =====");
    
    // Return the posts data for use in knowledge base
    return {
      posts: posts.map(post => ({
        id: post.id,
        content: post.content,
        author: post.user.name,
        username: post.user.username,
        createdAt: new Date(parseInt(post.createdAt)).toLocaleString(),
        isPinned: post.isPinned,
        isEdited: post.isEdited
      }))
    };
    
  } catch (error) {
    console.error("Error fetching announcements:", error);
    
    // Check if it's a known error type
    if (error.response) {
      console.error("API Error Response:", JSON.stringify(error.response.data || {}, null, 2));
    }
    
    return null;
  }
}

// Main function to execute
async function main() {
  try {
    // Get experience ID from environment or use the provided one
    const experienceId = "exp_7Q01flmyfDx3FT";
    
    console.log("===== WHOP ANNOUNCEMENTS FETCHER =====");
    console.log(`- Target Experience ID: ${experienceId}`);
    console.log("\n");
    
    const announcements = await fetchAnnouncements(experienceId);
    
    if (announcements && announcements.posts && announcements.posts.length > 0) {
      // Generate knowledge base format
      console.log("\n===== KNOWLEDGE BASE FORMAT =====");
      let knowledgeBase = "## ANNOUNCEMENTS\n\n";
      
      announcements.posts.forEach((post, index) => {
        knowledgeBase += `### Announcement ${index + 1}${post.isPinned ? " (PINNED)" : ""}\n`;
        knowledgeBase += post.content + "\n\n";
        knowledgeBase += `Posted by: ${post.author} on ${post.createdAt}\n\n`;
        if (index < announcements.posts.length - 1) {
          knowledgeBase += "---\n\n";
        }
      });
      
      console.log(knowledgeBase);
      
      // Save to a file for integration into knowledge base
      console.log("\nAnnouncements retrieved successfully and formatted for knowledge base!");
    }
    
  } catch (error) {
    console.error("Fatal error:", error);
  }
}

// Execute the main function
main().finally(() => process.exit(0));