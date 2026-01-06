# Quarterly Retraining Plan

**Model:** Claim Detector 98% (Certified)  
**Version:** 1.0  
**Last Retraining:** 2025-11-13  
**Next Retraining:** 2026-02-13 (Q1 2026)

---

## 📅 Retraining Schedule

### Standard Schedule
- **Quarterly:** Every 3 months
- **Next Retraining:** Q1 2026 (February)
- **Subsequent:** Q2 2026 (May), Q3 2026 (August), Q4 2026 (November)

### Trigger-Based Retraining
Retrain immediately if:
- **Accuracy drops below 95%** (critical)
- **Major marketplace changes** (policy updates, new claim types)
- **Data drift exceeds 10%** (significant distribution shift)
- **Concept drift detected** (label patterns change)

---

## 🔄 Retraining Workflow

### Phase 1: Data Collection (Week 1)

**Objective:** Collect new data while maintaining chronological order

**Tasks:**
- [ ] Collect new claims data from production
- [ ] Target: +500-1,000 new samples minimum
- [ ] Maintain chronological order (sort by `claim_date`)
- [ ] Ensure class balance (target: 1.5:1 to 2:1 ratio)
- [ ] Validate data quality (use `validate_new_data.py`)

**Deliverables:**
- New data CSV file
- Data quality report
- Class distribution report

**Commands:**
```bash
# Validate new data
python scripts/validate_new_data.py --data-path new_claims_q1_2026.csv --output validation_report.json
```

---

### Phase 2: Data Integration (Week 1)

**Objective:** Integrate new data with existing dataset

**Tasks:**
- [ ] Create backup of current dataset
- [ ] Integrate new data (use `integrate_new_data.py`)
- [ ] Verify no duplicates
- [ ] Maintain chronological order
- [ ] Create new train/val/test splits (70/15/15)

**Deliverables:**
- Integrated dataset
- Backup of previous dataset
- Updated train/val/test splits

**Commands:**
```bash
# Integrate data
python scripts/integrate_new_data.py --new-data new_claims_q1_2026.csv --backup --create-splits
```

---

### Phase 3: Validation (Week 1-2)

**Objective:** Validate integration and check for issues

**Tasks:**
- [ ] Run feature audit (check for leakage)
- [ ] Run time-series CV (check stability)
- [ ] Verify no regressions
- [ ] Check class balance maintained

**Deliverables:**
- Feature audit report
- Time-series CV results
- Validation summary

**Commands:**
```bash
# Feature audit
python scripts/feature_audit.py

# Time-series CV
python scripts/time_series_cv.py
```

---

### Phase 4: Model Retraining (Week 2)

**Objective:** Retrain model with expanded dataset

**Tasks:**
- [ ] Run full training pipeline
- [ ] Verify all certification metrics
- [ ] Check for improvements or regressions
- [ ] Document results

**Deliverables:**
- New model artifacts
- Training report
- Certification metrics

**Commands:**
```bash
# Retrain model
python scripts/train_98_percent_model.py
```

---

### Phase 5: Certification Check (Week 2)

**Objective:** Verify model meets certification criteria

**Tasks:**
- [ ] Verify CV mean ≥0.94
- [ ] Verify CV std ≤0.015
- [ ] Verify Bootstrap lower ≥0.96
- [ ] Verify Permutation p <0.05
- [ ] Verify Test accuracy ≥0.98
- [ ] Verify Latency P95 ≤2000ms

**Deliverables:**
- Certification report
- Updated dashboard
- Go/No-go decision

**Checklist:**
- [ ] All 5 metrics green
- [ ] No regressions from previous version
- [ ] Performance stable or improved

---

### Phase 6: Deployment (Week 2-3)

**Objective:** Deploy new model to production

**Tasks:**
- [ ] Create deployment package
- [ ] Run A/B test (if applicable)
- [ ] Deploy to staging
- [ ] Verify staging performance
- [ ] Deploy to production
- [ ] Monitor initial performance

**Deliverables:**
- Deployed model
- Deployment report
- Monitoring dashboard updated

**Commands:**
```bash
# Deploy model
python scripts/deploy_model.py

# Set up monitoring
python scripts/setup_monitoring.py
```

---

## 📊 Success Criteria

### Minimum Requirements
- **CV Mean:** ≥0.94 (maintain or improve)
- **CV Std:** ≤0.015 (maintain or improve)
- **Test Accuracy:** ≥0.98 (maintain or improve)
- **No Regressions:** All metrics stable or better

### Target Improvements
- **CV Mean:** Improve to ≥0.995 (if possible)
- **CV Std:** Reduce to ≤0.003 (if possible)
- **Test Accuracy:** Improve to ≥0.995 (if possible)

---

## 📝 Documentation Updates

After each retraining:

1. **Update `ML_CERTIFICATION_DASHBOARD.md`**
   - Add new iteration
   - Update metrics
   - Track trends

2. **Update `QUARTERLY_RETRAINING_PLAN.md`**
   - Update last retraining date
   - Update next retraining date
   - Document any issues or improvements

3. **Create Retraining Report**
   - Document changes
   - Compare with previous version
   - Note any improvements or regressions

---

## 🎯 Quarterly Retraining Checklist

### Pre-Retraining
- [ ] Review current model performance
- [ ] Identify data collection sources
- [ ] Plan data collection timeline
- [ ] Schedule retraining window

### During Retraining
- [ ] Collect new data
- [ ] Validate data quality
- [ ] Integrate data
- [ ] Run validation checks
- [ ] Retrain model
- [ ] Verify certification

### Post-Retraining
- [ ] Deploy new model
- [ ] Update documentation
- [ ] Monitor performance
- [ ] Plan next retraining

---

## 📈 Expected Outcomes

### With +500-1,000 New Samples
- **Dataset:** 3,240-3,740 total samples
- **CV Mean:** Maintain ≥0.99
- **CV Std:** Maintain ≤0.005
- **Test Accuracy:** Maintain ≥0.99

### With +1,000-2,000 New Samples
- **Dataset:** 3,740-4,740 total samples
- **CV Mean:** Potentially improve to ≥0.995
- **CV Std:** Potentially reduce to ≤0.003
- **Test Accuracy:** Potentially improve to ≥0.995

---

## ⚠️ Risk Mitigation

### If Retraining Fails
1. **Keep current model** in production
2. **Investigate issues** (data quality, feature drift, etc.)
3. **Fix issues** and retry
4. **Document lessons learned**

### If Performance Degrades
1. **Compare datasets** (old vs. new)
2. **Check for data quality issues**
3. **Review feature engineering**
4. **Consider rolling back** if critical

---

## 📅 Quarterly Schedule Template

### Q1 2026 (February)
- **Data Collection:** Week 1
- **Integration & Validation:** Week 1-2
- **Retraining:** Week 2
- **Deployment:** Week 2-3

### Q2 2026 (May)
- **Data Collection:** Week 1
- **Integration & Validation:** Week 1-2
- **Retraining:** Week 2
- **Deployment:** Week 2-3

### Q3 2026 (August)
- **Data Collection:** Week 1
- **Integration & Validation:** Week 1-2
- **Retraining:** Week 2
- **Deployment:** Week 2-3

### Q4 2026 (November)
- **Data Collection:** Week 1
- **Integration & Validation:** Week 1-2
- **Retraining:** Week 2
- **Deployment:** Week 2-3

---

## 🔍 Monitoring Between Retrainings

### Weekly Checks
- Monitor accuracy trends
- Check for data drift
- Review prediction distribution
- Monitor latency

### Monthly Reviews
- Full performance review
- Feature importance analysis
- Concept drift detection
- Retraining decision (if needed)

---

## 📞 Support

**Questions or Issues:**
1. Review `PRODUCTION_DEPLOYMENT_GUIDE.md`
2. Check `ML_CERTIFICATION_DASHBOARD.md` for metrics
3. Review previous retraining reports
4. Consult team lead if needed

---

**Last Updated:** 2025-11-13  
**Next Retraining:** 2026-02-13  
**Status:** ✅ **PLAN READY**

