import { WhopServerSdk, makeUserTokenVerifier } from "@whop/api";

export const whopSdk = WhopServerSdk({
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