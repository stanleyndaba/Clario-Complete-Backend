/**
 * Lab Scenario Template
 * 
 * Define your synthetic data for edge-case calibration here.
 */

export interface TestScenario {
    id: string;
    description: string;
    input: any;
    expectedDetections: number;
    expectedValue: number;
}

export const scenarios: TestScenario[] = [
    {
        id: 'S01-BASE',
        description: 'Standard positive case',
        input: {
            // ... your mock data here
        },
        expectedDetections: 1,
        expectedValue: 100.00
    },
    {
        id: 'S02-EDGE',
        description: 'Boundary condition check',
        input: {
            // ... your mock data here
        },
        expectedDetections: 0,
        expectedValue: 0
    }
];
