"""
Model calibration (Platt scaling, isotonic regression).
"""
from sklearn.calibration import CalibratedClassifierCV

def calibrate_model(model, X_val, y_val, method='isotonic'):
    """Calibrate model probabilities."""
    calibrated_model = CalibratedClassifierCV(model, method=method)
    calibrated_model.fit(X_val, y_val)
    return calibrated_model 