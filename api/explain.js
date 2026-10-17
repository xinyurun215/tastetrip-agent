import { createExplainHandler } from '../server/handleExplain.js';

// Server-only environment. Production remains closed during the preview phase.
export default createExplainHandler({env:process.env});
