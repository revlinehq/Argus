export default {
  providers: [
    {
      // Clerk Frontend API URL, e.g. https://verb-noun-00.clerk.accounts.dev
      // Set with: npx convex env set CLERK_JWT_ISSUER_DOMAIN <url>
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
