import '@whop/api';

declare module '@whop/api' {
  interface WhopServerSdkOptions {
    appId?: string;
    appApiKey: string;
    onBehalfOfUserId?: string;
    companyId?: string;
    [key: string]: any;
  }

  interface PostType {
    id: string;
    content: string;
    createdAt: string;
    user: {
      id: string;
      name: string;
      username: string;
    };
    isPinned?: boolean;
    isEdited?: boolean;
    [key: string]: any;
  }

  interface FeedPostsResult {
    feedPosts?: {
      posts?: PostType[];
    };
    [key: string]: any;
  }

  interface WhopServerSdkInstance {
    listForumPostsFromForum(options: { experienceId: string }): Promise<FeedPostsResult>;
    [key: string]: any;
  }

  export function WhopServerSdk(options: WhopServerSdkOptions): WhopServerSdkInstance;
}