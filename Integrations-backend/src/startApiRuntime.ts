process.env.RUNTIME_ROLE = process.env.RUNTIME_ROLE || 'api';
process.env.RUN_RECOVERIES_LANE_IN_API_PROCESS = process.env.RUN_RECOVERIES_LANE_IN_API_PROCESS || 'false';
process.env.RUN_BILLING_LANE_IN_API_PROCESS = process.env.RUN_BILLING_LANE_IN_API_PROCESS || 'false';

import './index';
