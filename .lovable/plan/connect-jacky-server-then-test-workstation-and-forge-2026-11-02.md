# Connect Jacky server, then test Workstation and Forge

## Steps
1. You open the project on the SAS-JACKY branch (this copy has no Jackie app, so Workstation and Forge don't exist here).
2. Send the secure form for your Jacky server address (and an optional access token). The address must start with https:// and be reachable from the internet. Localhost won't work.
3. After you save it, check that the Jacky link answers with real data instead of "not configured".
4. Open Workstation and Forge in a test browser while signed in, run one real action on each, and confirm the result shows on screen with no blank screen.
5. Report exactly what worked and what didn't. The Realism Overhaul tests and publishing wait until you ask again on the right branch.

## Technical details
- Secrets: JACKY_API_BASE (required), JACKY_API_TOKEN (optional).
- Check: call jacky-proxy and expect ok: true. Then use Playwright with a restored session on /workstation and /forge.
