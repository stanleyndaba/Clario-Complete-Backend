"""
Database models for Evidence & Value Engine
"""
from sqlalchemy import Column, String, DateTime, Integer, Numeric, Text, JSON, ForeignKey, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import uuid

Base = declarative_base()

class Invoice(Base):
    """Invoice model for storing invoice metadata and file information"""
    __tablename__ = 'invoices'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    seller_id = Column(String(36), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    storage_url = Column(String(500), nullable=False)
    mime_type = Column(String(100), nullable=False)
    bytes = Column(Integer, nullable=False)
    uploaded_at = Column(DateTime, default=func.now(), nullable=False)
    invoice_date = Column(DateTime, nullable=True)
    currency = Column(String(10), nullable=True)
    ocr_status = Column(String(20), default='pending', nullable=False)  # pending|processing|done|failed
    ocr_confidence = Column(Numeric(5, 4), nullable=True)
    ocr_completed_at = Column(DateTime, nullable=True)
    
    # Relationships
    items = relationship("InvoiceItem", back_populates="invoice", cascade="all, delete-orphan")
    landed_costs = relationship("LandedCost", back_populates="invoice", cascade="all, delete-orphan")
    
    # Indexes
    __table_args__ = (
        Index('idx_invoices_seller_uploaded', 'seller_id', 'uploaded_at'),
        Index('idx_invoices_ocr_status', 'ocr_status'),
    )

class InvoiceItem(Base):
    """Invoice line item model for storing extracted item data"""
    __tablename__ = 'invoice_items'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    invoice_id = Column(String(36), ForeignKey('invoices.id'), nullable=False)
    raw_sku = Column(String(100), nullable=True)
    mapped_sku = Column(String(100), nullable=True)
    asin = Column(String(20), nullable=True)
    description = Column(Text, nullable=True)
    unit_cost = Column(Numeric(12, 4), nullable=True)
    quantity = Column(Integer, nullable=True)
    currency = Column(String(10), nullable=True)
    total_cost = Column(Numeric(12, 4), nullable=True)
    confidence = Column(Numeric(5, 4), nullable=True)
    extracted_at = Column(DateTime, default=func.now(), nullable=False)
    
    # Relationships
    invoice = relationship("Invoice", back_populates="items")
    
    # Indexes
    __table_args__ = (
        Index('idx_invoice_items_invoice', 'invoice_id'),
        Index('idx_invoice_items_sku_asin', 'mapped_sku', 'asin'),
        Index('idx_invoice_items_raw_sku', 'raw_sku'),
    )

class LandedCost(Base):
    """Landed cost model for storing calculated landed costs per SKU"""
    __tablename__ = 'landed_costs'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    seller_id = Column(String(36), nullable=False, index=True)
    sku = Column(String(100), nullable=False, index=True)
    asin = Column(String(20), nullable=True, index=True)
    invoice_id = Column(String(36), ForeignKey('invoices.id'), nullable=False)
    unit_cost = Column(Numeric(12, 4), nullable=False)
    freight_alloc = Column(Numeric(12, 4), nullable=False)
    duties_alloc = Column(Numeric(12, 4), nullable=False)
    prep_alloc = Column(Numeric(12, 4), nullable=False)
    other_alloc = Column(Numeric(12, 4), nullable=False)
    landed_per_unit = Column(Numeric(12, 4), nullable=False)
    total_landed_cost = Column(Numeric(12, 4), nullable=False)
    calc_meta = Column(JSON, nullable=True)
    calculated_at = Column(DateTime, default=func.now(), nullable=False)
    
    # Relationships
    invoice = relationship("Invoice", back_populates="landed_costs")
    
    # Indexes
    __table_args__ = (
        Index('idx_landed_costs_seller_sku', 'seller_id', 'sku'),
        Index('idx_landed_costs_seller_asin', 'seller_id', 'asin'),
        Index('idx_landed_costs_calculated', 'calculated_at'),
    )

class ValueComparison(Base):
    """Value comparison model for storing Amazon default vs Opside True Value comparisons"""
    __tablename__ = 'value_comparisons'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    seller_id = Column(String(36), nullable=False, index=True)
    sku = Column(String(100), nullable=False, index=True)
    asin = Column(String(20), nullable=True, index=True)
    amazon_default = Column(Numeric(12, 4), nullable=True)
    opside_true_value = Column(Numeric(12, 4), nullable=True)
    net_gain = Column(Numeric(12, 4), nullable=True)
    comparison_status = Column(String(50), nullable=False, default='pending')
    source_invoice_id = Column(String(36), ForeignKey('invoices.id'), nullable=True)
    proof_meta = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationships
    invoice = relationship("Invoice")
    
    # Indexes
    __table_args__ = (
        Index('idx_value_comparisons_seller_sku', 'seller_id', 'sku'),
        Index('idx_value_comparisons_seller_asin', 'seller_id', 'asin'),
        Index('idx_value_comparisons_status', 'comparison_status'),
        Index('idx_value_comparisons_created', 'created_at'),
    )

class SellerCostPolicy(Base):
    """Seller cost allocation policy model"""
    __tablename__ = 'seller_cost_policies'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    seller_id = Column(String(36), nullable=False, unique=True, index=True)
    freight_pct = Column(Numeric(5, 2), default=5.00, nullable=False)
    duties_pct = Column(Numeric(5, 2), default=2.00, nullable=False)
    prep_pct = Column(Numeric(5, 2), default=1.00, nullable=False)
    other_pct = Column(Numeric(5, 2), default=0.00, nullable=False)
    minimum_freight = Column(Numeric(12, 4), default=25.00, nullable=False)
    minimum_duties = Column(Numeric(12, 4), default=10.00, nullable=False)
    currency = Column(String(10), default='USD', nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)

class EvidenceAuditLog(Base):
    """Audit log for evidence processing activities"""
    __tablename__ = 'evidence_audit_logs'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    seller_id = Column(String(36), nullable=False, index=True)
    action = Column(String(100), nullable=False)  # upload, ocr, landed_cost, value_compare
    entity_type = Column(String(50), nullable=False)  # invoice, item, landed_cost, comparison
    entity_id = Column(String(36), nullable=True)
    status = Column(String(20), nullable=False)  # success, failed, pending
    details = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    processing_time_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    
    # Indexes
    __table_args__ = (
        Index('idx_audit_logs_seller_action', 'seller_id', 'action'),
        Index('idx_audit_logs_entity', 'entity_type', 'entity_id'),
        Index('idx_audit_logs_status', 'status'),
        Index('idx_audit_logs_created', 'created_at'),
    )

# Update existing Claim model to include evidence fields
class Claim(Base):
    """Updated Claim model with evidence integration"""
    __tablename__ = 'claims'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    seller_id = Column(String(36), nullable=False, index=True)
    sku = Column(String(100), nullable=True, index=True)
    asin = Column(String(20), nullable=True, index=True)
    status = Column(String(50), nullable=False, default='pending')
    
    # Evidence and value fields
    amazon_default = Column(Numeric(12, 4), nullable=True)
    opside_value = Column(Numeric(12, 4), nullable=True)
    net_gain = Column(Numeric(12, 4), nullable=True)
    evidence_invoice_id = Column(String(36), ForeignKey('invoices.id'), nullable=True)
    
    # Existing fields (placeholder - these would be merged with existing Claim model)
    claim_amount = Column(Numeric(12, 4), nullable=True)
    reason_code = Column(String(50), nullable=True)
    marketplace = Column(String(10), nullable=True)
    
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    
    # Relationships
    evidence_invoice = relationship("Invoice")
    
    # Indexes
    __table_args__ = (
        Index('idx_claims_seller_sku', 'seller_id', 'sku'),
        Index('idx_claims_seller_asin', 'seller_id', 'asin'),
        Index('idx_claims_status', 'status'),
        Index('idx_claims_created', 'created_at'),
    )
