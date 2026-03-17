import { SentinelSyncedData, LossEvent, ReimbursementEvent } from '../services/detection/algorithms/duplicateMissedReimbursementAlgorithm';

export type SentinelAnomalyType = 'missed_reimbursement' | 'duplicate_reimbursement' | 'clawback_risk' | 'ASYMMETRIC_CLAWBACK' | 'GHOST_REVERSAL';

export interface SentinelScenario {
    id: string;
    description: string;
    family: string;
    data: SentinelSyncedData;
    expected_results: {
        has_anomaly: boolean;
        expected_anomaly_count?: number;
        expected_detection_types?: SentinelAnomalyType[];
        expected_value_delta?: number;
    };
}

export const SENTINEL_LAB_SCENARIOS: SentinelScenario[] = [
    {
        "id": "R1-PARTIAL-01",
        "description": "Partial chain: 10 units loss, reimbursed 4 + 4 units",
        "family": "R1-Partial-Chains",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L1",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 10,
                    "estimated_value": 100,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R1-1"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R1a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 4,
                    "amount": 40,
                    "currency": "USD",
                    "order_id": "O-R1-1"
                },
                {
                    "id": "R1b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 4,
                    "amount": 40,
                    "currency": "USD",
                    "order_id": "O-R1-1"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 20
        }
    },
    {
        "id": "R1-PARTIAL-02",
        "description": "Partial chain: 10 units loss, reimbursed 4 + 4 units",
        "family": "R1-Partial-Chains",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L2",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 10,
                    "estimated_value": 100,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R1-2"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R2a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 4,
                    "amount": 40,
                    "currency": "USD",
                    "order_id": "O-R1-2"
                },
                {
                    "id": "R2b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 4,
                    "amount": 40,
                    "currency": "USD",
                    "order_id": "O-R1-2"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 20
        }
    },
    {
        "id": "R1-PARTIAL-03",
        "description": "Partial chain: 10 units loss, reimbursed 4 + 4 units",
        "family": "R1-Partial-Chains",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L3",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 10,
                    "estimated_value": 100,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R1-3"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R3a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 4,
                    "amount": 40,
                    "currency": "USD",
                    "order_id": "O-R1-3"
                },
                {
                    "id": "R3b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 4,
                    "amount": 40,
                    "currency": "USD",
                    "order_id": "O-R1-3"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 20
        }
    },
    {
        "id": "R1-PARTIAL-04",
        "description": "Partial chain: 10 units loss, reimbursed 4 + 6 units",
        "family": "R1-Partial-Chains",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L4",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 10,
                    "estimated_value": 100,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R1-4"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R4a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 4,
                    "amount": 40,
                    "currency": "USD",
                    "order_id": "O-R1-4"
                },
                {
                    "id": "R4b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 6,
                    "amount": 60,
                    "currency": "USD",
                    "order_id": "O-R1-4"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R1-PARTIAL-05",
        "description": "Partial chain: 10 units loss, reimbursed 4 + 6 units",
        "family": "R1-Partial-Chains",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L5",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 10,
                    "estimated_value": 100,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R1-5"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R5a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 4,
                    "amount": 40,
                    "currency": "USD",
                    "order_id": "O-R1-5"
                },
                {
                    "id": "R5b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 6,
                    "amount": 60,
                    "currency": "USD",
                    "order_id": "O-R1-5"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R1-PARTIAL-06",
        "description": "Partial chain: 10 units loss, reimbursed 4 + 6 units",
        "family": "R1-Partial-Chains",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L6",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 10,
                    "estimated_value": 100,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R1-6"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R6a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 4,
                    "amount": 40,
                    "currency": "USD",
                    "order_id": "O-R1-6"
                },
                {
                    "id": "R6b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 6,
                    "amount": 60,
                    "currency": "USD",
                    "order_id": "O-R1-6"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R2-OUT-OF-ORDER-01",
        "description": "Loss and Reimb with scrambled dates.",
        "family": "R2-Out-of-Order",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L1",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-02-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R2-1"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R1a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-15",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R2-1"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R2-OUT-OF-ORDER-02",
        "description": "Loss and Reimb with scrambled dates.",
        "family": "R2-Out-of-Order",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L2",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-02-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R2-2"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R2a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-15",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R2-2"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R2-OUT-OF-ORDER-03",
        "description": "Loss and Reimb with scrambled dates.",
        "family": "R2-Out-of-Order",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L3",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-02-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R2-3"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R3a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-15",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R2-3"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R2-OUT-OF-ORDER-04",
        "description": "Loss and Reimb with scrambled dates.",
        "family": "R2-Out-of-Order",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L4",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-02-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R2-4"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R4a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-15",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R2-4"
                },
                {
                    "id": "R4b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-02-15",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R2-4"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "duplicate_reimbursement"
            ],
            "expected_value_delta": 20
        }
    },
    {
        "id": "R2-OUT-OF-ORDER-05",
        "description": "Loss and Reimb with scrambled dates.",
        "family": "R2-Out-of-Order",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L5",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-02-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R2-5"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R5a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-15",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R2-5"
                },
                {
                    "id": "R5b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-02-15",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R2-5"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "duplicate_reimbursement"
            ],
            "expected_value_delta": 20
        }
    },
    {
        "id": "R2-OUT-OF-ORDER-06",
        "description": "Loss and Reimb with scrambled dates.",
        "family": "R2-Out-of-Order",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L6",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-02-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R2-6"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R6a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-15",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R2-6"
                },
                {
                    "id": "R6b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-02-15",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R2-6"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "duplicate_reimbursement"
            ],
            "expected_value_delta": 20
        }
    },
    {
        "id": "R3-DELAYED-01",
        "description": "Over 90 days delay between loss and reimbursement.",
        "family": "R3-Delayed-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L1",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R3-1"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R1a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-05-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R3-1"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R3-DELAYED-02",
        "description": "Over 90 days delay between loss and reimbursement.",
        "family": "R3-Delayed-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L2",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R3-2"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R2a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-05-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R3-2"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R3-DELAYED-03",
        "description": "Over 90 days delay between loss and reimbursement.",
        "family": "R3-Delayed-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L3",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R3-3"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R3a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-05-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R3-3"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R3-DELAYED-04",
        "description": "Over 90 days delay between loss and reimbursement.",
        "family": "R3-Delayed-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L4",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R3-4"
                }
            ],
            "reimbursement_events": []
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 20
        }
    },
    {
        "id": "R3-DELAYED-05",
        "description": "Over 90 days delay between loss and reimbursement.",
        "family": "R3-Delayed-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L5",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R3-5"
                }
            ],
            "reimbursement_events": []
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 20
        }
    },
    {
        "id": "R3-DELAYED-06",
        "description": "Over 90 days delay between loss and reimbursement.",
        "family": "R3-Delayed-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L6",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R3-6"
                }
            ],
            "reimbursement_events": []
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 20
        }
    },
    {
        "id": "R4-DUPLICATE-01",
        "description": "Order refunded multiple times securely tracking same ID.",
        "family": "R4-Duplicate-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L1",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "estimated_value": 50,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R4-1"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R1a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-R4-1"
                },
                {
                    "id": "R1b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-R4-1"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "duplicate_reimbursement"
            ],
            "expected_value_delta": 50
        }
    },
    {
        "id": "R4-DUPLICATE-02",
        "description": "Order refunded multiple times securely tracking same ID.",
        "family": "R4-Duplicate-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L2",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "estimated_value": 50,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R4-2"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R2a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-R4-2"
                },
                {
                    "id": "R2b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-R4-2"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "duplicate_reimbursement"
            ],
            "expected_value_delta": 50
        }
    },
    {
        "id": "R4-DUPLICATE-03",
        "description": "Order refunded multiple times securely tracking same ID.",
        "family": "R4-Duplicate-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L3",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "estimated_value": 50,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R4-3"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R3a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-R4-3"
                },
                {
                    "id": "R3b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-R4-3"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "duplicate_reimbursement"
            ],
            "expected_value_delta": 50
        }
    },
    {
        "id": "R4-DUPLICATE-04",
        "description": "Order refunded multiple times securely tracking same ID.",
        "family": "R4-Duplicate-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L4",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "estimated_value": 50,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R4-4"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R4a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-R4-4"
                },
                {
                    "id": "R4b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-R4-4"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "duplicate_reimbursement"
            ],
            "expected_value_delta": 50
        }
    },
    {
        "id": "R4-DUPLICATE-05",
        "description": "Order refunded multiple times securely tracking same ID.",
        "family": "R4-Duplicate-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L5",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "estimated_value": 50,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R4-5"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R5a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-R4-5"
                },
                {
                    "id": "R5b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-R4-5"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "duplicate_reimbursement"
            ],
            "expected_value_delta": 50
        }
    },
    {
        "id": "R4-DUPLICATE-06",
        "description": "Order refunded multiple times securely tracking same ID.",
        "family": "R4-Duplicate-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L6",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "estimated_value": 50,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R4-6"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R6a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-R4-6"
                },
                {
                    "id": "R6b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-R4-6"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "duplicate_reimbursement"
            ],
            "expected_value_delta": 50
        }
    },
    {
        "id": "R5-REVERSAL-01",
        "description": "Reversal tracking chains. Ghost: true, Asym: false, Clean: false",
        "family": "R5-Reversal-Lineage",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L1",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 25,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R5-1"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R1a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 25,
                    "currency": "USD",
                    "order_id": "O-R5-1"
                },
                {
                    "id": "R1b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": -1,
                    "amount": -25,
                    "currency": "USD",
                    "order_id": "O-R5-1"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "GHOST_REVERSAL"
            ],
            "expected_value_delta": 25
        }
    },
    {
        "id": "R5-REVERSAL-02",
        "description": "Reversal tracking chains. Ghost: true, Asym: false, Clean: false",
        "family": "R5-Reversal-Lineage",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L2",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 25,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R5-2"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R2a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 25,
                    "currency": "USD",
                    "order_id": "O-R5-2"
                },
                {
                    "id": "R2b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": -1,
                    "amount": -25,
                    "currency": "USD",
                    "order_id": "O-R5-2"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "GHOST_REVERSAL"
            ],
            "expected_value_delta": 25
        }
    },
    {
        "id": "R5-REVERSAL-03",
        "description": "Reversal tracking chains. Ghost: false, Asym: true, Clean: false",
        "family": "R5-Reversal-Lineage",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L3",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 25,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R5-3"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R3a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 25,
                    "currency": "USD",
                    "order_id": "O-R5-3"
                },
                {
                    "id": "R3b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": -1,
                    "amount": -50,
                    "currency": "USD",
                    "order_id": "O-R5-3"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "ASYMMETRIC_CLAWBACK"
            ],
            "expected_value_delta": 25
        }
    },
    {
        "id": "R5-REVERSAL-04",
        "description": "Reversal tracking chains. Ghost: false, Asym: true, Clean: false",
        "family": "R5-Reversal-Lineage",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L4",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 25,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R5-4"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R4a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 25,
                    "currency": "USD",
                    "order_id": "O-R5-4"
                },
                {
                    "id": "R4b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": -1,
                    "amount": -50,
                    "currency": "USD",
                    "order_id": "O-R5-4"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "ASYMMETRIC_CLAWBACK"
            ],
            "expected_value_delta": 25
        }
    },
    {
        "id": "R5-REVERSAL-05",
        "description": "Reversal tracking chains. Ghost: false, Asym: false, Clean: true",
        "family": "R5-Reversal-Lineage",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L5",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 25,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R5-5"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R5a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 25,
                    "currency": "USD",
                    "order_id": "O-R5-5"
                },
                {
                    "id": "R5b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": -1,
                    "amount": -25,
                    "currency": "USD",
                    "order_id": "O-R5-5"
                },
                {
                    "id": "R5c",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 25,
                    "currency": "USD",
                    "order_id": "O-R5-5"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R5-REVERSAL-06",
        "description": "Reversal tracking chains. Ghost: false, Asym: false, Clean: true",
        "family": "R5-Reversal-Lineage",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L6",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 25,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R5-6"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R6a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 25,
                    "currency": "USD",
                    "order_id": "O-R5-6"
                },
                {
                    "id": "R6b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": -1,
                    "amount": -25,
                    "currency": "USD",
                    "order_id": "O-R5-6"
                },
                {
                    "id": "R6c",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 25,
                    "currency": "USD",
                    "order_id": "O-R5-6"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R6-MULTI-SKU-01",
        "description": "Multiple SKUs identically lost under one order.",
        "family": "R6-Multi-SKU-Order",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L1a",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 10,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R6-1"
                },
                {
                    "id": "L1b",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-B",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R6-1"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R1a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 10,
                    "currency": "USD",
                    "order_id": "O-R6-1"
                },
                {
                    "id": "R1b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-B",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R6-1"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R6-MULTI-SKU-02",
        "description": "Multiple SKUs identically lost under one order.",
        "family": "R6-Multi-SKU-Order",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L2a",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 10,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R6-2"
                },
                {
                    "id": "L2b",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-B",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R6-2"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R2a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 10,
                    "currency": "USD",
                    "order_id": "O-R6-2"
                },
                {
                    "id": "R2b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-B",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R6-2"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R6-MULTI-SKU-03",
        "description": "Multiple SKUs identically lost under one order.",
        "family": "R6-Multi-SKU-Order",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L3a",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 10,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R6-3"
                },
                {
                    "id": "L3b",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-B",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R6-3"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R3a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 10,
                    "currency": "USD",
                    "order_id": "O-R6-3"
                },
                {
                    "id": "R3b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-B",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-R6-3"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R6-MULTI-SKU-04",
        "description": "Multiple SKUs identically lost under one order.",
        "family": "R6-Multi-SKU-Order",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L4a",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 10,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R6-4"
                },
                {
                    "id": "L4b",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-B",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R6-4"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R4a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 10,
                    "currency": "USD",
                    "order_id": "O-R6-4"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 20
        }
    },
    {
        "id": "R6-MULTI-SKU-05",
        "description": "Multiple SKUs identically lost under one order.",
        "family": "R6-Multi-SKU-Order",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L5a",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 10,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R6-5"
                },
                {
                    "id": "L5b",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-B",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R6-5"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R5a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 10,
                    "currency": "USD",
                    "order_id": "O-R6-5"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 20
        }
    },
    {
        "id": "R6-MULTI-SKU-06",
        "description": "Multiple SKUs identically lost under one order.",
        "family": "R6-Multi-SKU-Order",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L6a",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 10,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R6-6"
                },
                {
                    "id": "L6b",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-B",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R6-6"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R6a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 10,
                    "currency": "USD",
                    "order_id": "O-R6-6"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 20
        }
    },
    {
        "id": "R7-CROSS-TENANT-01",
        "description": "Same Order ID across two tenants shouldn't leak.",
        "family": "R7-Cross-Tenant-Collisions",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L1",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 30,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R7-1"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R1a",
                    "seller_id": "SELLER_2",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 30,
                    "currency": "USD",
                    "order_id": "O-R7-1"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 30
        }
    },
    {
        "id": "R7-CROSS-TENANT-02",
        "description": "Same Order ID across two tenants shouldn't leak.",
        "family": "R7-Cross-Tenant-Collisions",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L2",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 30,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R7-2"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R2a",
                    "seller_id": "SELLER_2",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 30,
                    "currency": "USD",
                    "order_id": "O-R7-2"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 30
        }
    },
    {
        "id": "R7-CROSS-TENANT-03",
        "description": "Same Order ID across two tenants shouldn't leak.",
        "family": "R7-Cross-Tenant-Collisions",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L3",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 30,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R7-3"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R3a",
                    "seller_id": "SELLER_2",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 30,
                    "currency": "USD",
                    "order_id": "O-R7-3"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 30
        }
    },
    {
        "id": "R7-CROSS-TENANT-04",
        "description": "Same Order ID across two tenants shouldn't leak.",
        "family": "R7-Cross-Tenant-Collisions",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L4",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 30,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R7-4"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R4a",
                    "seller_id": "SELLER_2",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 30,
                    "currency": "USD",
                    "order_id": "O-R7-4"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 30
        }
    },
    {
        "id": "R7-CROSS-TENANT-05",
        "description": "Same Order ID across two tenants shouldn't leak.",
        "family": "R7-Cross-Tenant-Collisions",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L5",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 30,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R7-5"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R5a",
                    "seller_id": "SELLER_2",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 30,
                    "currency": "USD",
                    "order_id": "O-R7-5"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 30
        }
    },
    {
        "id": "R7-CROSS-TENANT-06",
        "description": "Same Order ID across two tenants shouldn't leak.",
        "family": "R7-Cross-Tenant-Collisions",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L6",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 30,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R7-6"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R6a",
                    "seller_id": "SELLER_2",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 30,
                    "currency": "USD",
                    "order_id": "O-R7-6"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 30
        }
    },
    {
        "id": "R8-SETTLEMENT-FRAG-01",
        "description": "Loss and Reimbursement spanning huge gaps conceptually distinct settlements.",
        "family": "R8-Settlement-Fragmentation",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L1",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2024-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 15,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R8-1"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R1a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-12-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 15,
                    "currency": "USD",
                    "order_id": "O-R8-1"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R8-SETTLEMENT-FRAG-02",
        "description": "Loss and Reimbursement spanning huge gaps conceptually distinct settlements.",
        "family": "R8-Settlement-Fragmentation",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L2",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2024-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 15,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R8-2"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R2a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-12-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 15,
                    "currency": "USD",
                    "order_id": "O-R8-2"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R8-SETTLEMENT-FRAG-03",
        "description": "Loss and Reimbursement spanning huge gaps conceptually distinct settlements.",
        "family": "R8-Settlement-Fragmentation",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L3",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2024-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 15,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R8-3"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R3a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-12-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 15,
                    "currency": "USD",
                    "order_id": "O-R8-3"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R8-SETTLEMENT-FRAG-04",
        "description": "Loss and Reimbursement spanning huge gaps conceptually distinct settlements.",
        "family": "R8-Settlement-Fragmentation",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L4",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2024-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 15,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R8-4"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R4a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-12-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 15,
                    "currency": "USD",
                    "order_id": "O-R8-4"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R8-SETTLEMENT-FRAG-05",
        "description": "Loss and Reimbursement spanning huge gaps conceptually distinct settlements.",
        "family": "R8-Settlement-Fragmentation",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L5",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2024-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 15,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R8-5"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R5a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-12-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 15,
                    "currency": "USD",
                    "order_id": "O-R8-5"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R8-SETTLEMENT-FRAG-06",
        "description": "Loss and Reimbursement spanning huge gaps conceptually distinct settlements.",
        "family": "R8-Settlement-Fragmentation",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L6",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2024-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 15,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R8-6"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R6a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-12-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 15,
                    "currency": "USD",
                    "order_id": "O-R8-6"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R9-ORPHAN-01",
        "description": "Reimbursement with zero causality trace.",
        "family": "R9-Orphan-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [],
            "reimbursement_events": [
                {
                    "id": "R1a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 45,
                    "currency": "USD",
                    "order_id": "O-R9-1"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "clawback_risk"
            ],
            "expected_value_delta": 45
        }
    },
    {
        "id": "R9-ORPHAN-02",
        "description": "Reimbursement with zero causality trace.",
        "family": "R9-Orphan-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [],
            "reimbursement_events": [
                {
                    "id": "R2a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 45,
                    "currency": "USD",
                    "order_id": "O-R9-2"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "clawback_risk"
            ],
            "expected_value_delta": 45
        }
    },
    {
        "id": "R9-ORPHAN-03",
        "description": "Reimbursement with zero causality trace.",
        "family": "R9-Orphan-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [],
            "reimbursement_events": [
                {
                    "id": "R3a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 45,
                    "currency": "USD",
                    "order_id": "O-R9-3"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "clawback_risk"
            ],
            "expected_value_delta": 45
        }
    },
    {
        "id": "R9-ORPHAN-04",
        "description": "Reimbursement with zero causality trace.",
        "family": "R9-Orphan-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [],
            "reimbursement_events": [
                {
                    "id": "R4a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 45,
                    "currency": "USD",
                    "order_id": "O-R9-4"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "clawback_risk"
            ],
            "expected_value_delta": 45
        }
    },
    {
        "id": "R9-ORPHAN-05",
        "description": "Reimbursement with zero causality trace.",
        "family": "R9-Orphan-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [],
            "reimbursement_events": [
                {
                    "id": "R5a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 45,
                    "currency": "USD",
                    "order_id": "O-R9-5"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "clawback_risk"
            ],
            "expected_value_delta": 45
        }
    },
    {
        "id": "R9-ORPHAN-06",
        "description": "Reimbursement with zero causality trace.",
        "family": "R9-Orphan-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [],
            "reimbursement_events": [
                {
                    "id": "R6a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 45,
                    "currency": "USD",
                    "order_id": "O-R9-6"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "clawback_risk"
            ],
            "expected_value_delta": 45
        }
    },
    {
        "id": "R10-EPSILON-01",
        "description": "Rounding noise vs real shortfall.",
        "family": "R10-Residual-Epsilon",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L1",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 10,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R10-1"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R1a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 9.97,
                    "currency": "USD",
                    "order_id": "O-R10-1"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R10-EPSILON-02",
        "description": "Rounding noise vs real shortfall.",
        "family": "R10-Residual-Epsilon",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L2",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 10,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R10-2"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R2a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 9.97,
                    "currency": "USD",
                    "order_id": "O-R10-2"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R10-EPSILON-03",
        "description": "Rounding noise vs real shortfall.",
        "family": "R10-Residual-Epsilon",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L3",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 10,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R10-3"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R3a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 9.97,
                    "currency": "USD",
                    "order_id": "O-R10-3"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "R10-EPSILON-04",
        "description": "Rounding noise vs real shortfall.",
        "family": "R10-Residual-Epsilon",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L4",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 10,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R10-4"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R4a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 9.9,
                    "currency": "USD",
                    "order_id": "O-R10-4"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 0.1
        }
    },
    {
        "id": "R10-EPSILON-05",
        "description": "Rounding noise vs real shortfall.",
        "family": "R10-Residual-Epsilon",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L5",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 10,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R10-5"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R5a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 9.9,
                    "currency": "USD",
                    "order_id": "O-R10-5"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 0.1
        }
    },
    {
        "id": "R10-EPSILON-06",
        "description": "Rounding noise vs real shortfall.",
        "family": "R10-Residual-Epsilon",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "L6",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 10,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-R10-6"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "R6a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 9.9,
                    "currency": "USD",
                    "order_id": "O-R10-6"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 0.1
        }
    },
    {
        "id": "GUARD-R2-DETECT",
        "description": "Detect scrambled chronology duplicate.",
        "family": "R2-Out-of-Order",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "G-L2",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-02-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-G-2"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "G-R2a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-15",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-G-2"
                },
                {
                    "id": "G-R2b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-02-15",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-G-2"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "duplicate_reimbursement"
            ],
            "expected_value_delta": 20
        }
    },
    {
        "id": "GUARD-R2-SUPPRESS",
        "description": "Suppress normal Out-of-Order 1:1 reimbursement.",
        "family": "R2-Out-of-Order",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "G-L2s",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-02-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 20,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-G-2s"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "G-R2s",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-15",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 20,
                    "currency": "USD",
                    "order_id": "O-G-2s"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "GUARD-R4-DETECT",
        "description": "Duplicate over 2 years.",
        "family": "R4-Duplicate-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "G-L4",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 50,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-G-4"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "G-R4a",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2023-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-G-4"
                },
                {
                    "id": "G-R4b",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-G-4"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "duplicate_reimbursement"
            ],
            "expected_value_delta": 50
        }
    },
    {
        "id": "GUARD-R4-SUPPRESS",
        "description": "Suppress valid staggered partial chunks across long boundary.",
        "family": "R4-Duplicate-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "G-L4s",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 2,
                    "estimated_value": 100,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-G-4s"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "G-R4sa",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2023-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-G-4s"
                },
                {
                    "id": "G-R4sb",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 50,
                    "currency": "USD",
                    "order_id": "O-G-4s"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "GUARD-R7-DETECT",
        "description": "Detect missed due to isolation.",
        "family": "R7-Cross-Tenant-Collisions",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "G-L7",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 30,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-G-7"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "G-R7a",
                    "seller_id": "SELLER_2",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 30,
                    "currency": "USD",
                    "order_id": "O-G-7"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 30
        }
    },
    {
        "id": "GUARD-R7-SUPPRESS",
        "description": "Suppress when tenant isolation explicitly succeeds.",
        "family": "R7-Cross-Tenant-Collisions",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "G-L7s",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 30,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-G-7s"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "G-R7sa",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 30,
                    "currency": "USD",
                    "order_id": "O-G-7s"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "GUARD-R9-DETECT",
        "description": "Detect strict orphan.",
        "family": "R9-Orphan-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [],
            "reimbursement_events": [
                {
                    "id": "G-R9",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 60,
                    "currency": "USD",
                    "order_id": "O-G-9"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "clawback_risk"
            ],
            "expected_value_delta": 60
        }
    },
    {
        "id": "GUARD-R9-SUPPRESS",
        "description": "Suppress zero amount orphan.",
        "family": "R9-Orphan-Reimbursements",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [],
            "reimbursement_events": [
                {
                    "id": "G-R9s",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 0,
                    "currency": "USD",
                    "order_id": "O-G-9s"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    },
    {
        "id": "GUARD-R10-DETECT",
        "description": "Detect anomaly > Epsilon.",
        "family": "R10-Residual-Epsilon",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "G-L10",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 10,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-G-10"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "G-R10",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 9.9,
                    "currency": "USD",
                    "order_id": "O-G-10"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": true,
            "expected_detection_types": [
                "missed_reimbursement"
            ],
            "expected_value_delta": 0.1
        }
    },
    {
        "id": "GUARD-R10-SUPPRESS",
        "description": "Suppress anomaly <= Epsilon noise.",
        "family": "R10-Residual-Epsilon",
        "data": {
            "seller_id": "SELLER_1",
            "sync_id": "SYNC_1",
            "loss_events": [
                {
                    "id": "G-L10s",
                    "seller_id": "SELLER_1",
                    "event_type": "lost",
                    "event_date": "2025-01-01",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "estimated_value": 10,
                    "currency": "USD",
                    "source": "inventory_ledger",
                    "order_id": "O-G-10s"
                }
            ],
            "reimbursement_events": [
                {
                    "id": "G-R10s",
                    "seller_id": "SELLER_1",
                    "reimbursement_date": "2025-01-05",
                    "sku": "SKU-A",
                    "quantity": 1,
                    "amount": 9.97,
                    "currency": "USD",
                    "order_id": "O-G-10s"
                }
            ]
        },
        "expected_results": {
            "has_anomaly": false,
            "expected_detection_types": [],
            "expected_value_delta": 0
        }
    }
];
