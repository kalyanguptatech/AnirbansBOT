import { verifyUserToken } from '@whop/api';
import { headers } from 'next/headers';
import ClientPage from './client-page';

export default async function CompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  const resolvedParams = await params;
  let userId = null;
  
  try {
    // Check authentication using Whop SDK
    const headersList = await headers();
    
    try {
      // Try to verify with Whop token
      const result = await verifyUserToken(headersList);
      userId = result.userId;
    } catch (authError) {
      // If in development mode, use a mock user ID
      if (process.env.NODE_ENV === 'development') {
        console.log('Running in development mode - using test user ID');
        userId = 'user_WRcmbDKkbMpLB';
      } else {
        // In production, we want to respect the auth error
        console.error('Authentication failed:', authError instanceof Error ? authError.message : String(authError));
      }
    }
    
    if (!userId) {
      return <ClientPage companyId={resolvedParams.companyId} isAuthorized={false} userId={null} />;
    }

    // For now, if we have a valid userId, consider them authorized
    // You can add more specific company ownership checks here if needed
    return <ClientPage companyId={resolvedParams.companyId} isAuthorized={true} userId={userId} />;
    
  } catch (error) {
    console.error('Authentication error:', error);
    return <ClientPage companyId={resolvedParams.companyId} isAuthorized={false} userId={null} />;
  }
}