"""Quick verification of expanded_claims.csv"""
import pandas as pd
from pathlib import Path

df = pd.read_csv(Path(__file__).parent.parent.parent / 'data' / 'ml-training' / 'expanded_claims.csv')
print(f'Total samples: {len(df)}')
print(f'\nClass distribution:')
print(df['claimable'].value_counts().sort_index())
non_claimable = df['claimable'].value_counts().get(0, 0)
claimable = df['claimable'].value_counts().get(1, 0)
print(f'\nClass balance: {non_claimable} non-claimable : {claimable} claimable')
print(f'Ratio: {non_claimable / claimable:.2f}:1' if claimable > 0 else 'N/A')
print(f'\nDate range: {df["claim_date"].min()} to {df["claim_date"].max()}')

