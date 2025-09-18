"""
Validation functions for Evidence & Value Engine
"""
import re
from typing import Dict, Any, List, Tuple
from fastapi import UploadFile

def validate_invoice_upload(file: UploadFile, seller_id: str) -> Dict[str, Any]:
    """
    Validate invoice upload request
    
    Args:
        file: Uploaded file
        seller_id: Seller identifier
        
    Returns:
        Validation result with is_valid flag and errors list
    """
    validation_result = {
        'is_valid': True,
        'errors': [],
        'warnings': []
    }
    
    # Validate seller_id
    if not seller_id or not seller_id.strip():
        validation_result['is_valid'] = False
        validation_result['errors'].append("Seller ID is required")
    
    # Validate file
    if not file:
        validation_result['is_valid'] = False
        validation_result['errors'].append("File is required")
        return validation_result
    
    # Validate filename
    if not file.filename or not file.filename.strip():
        validation_result['is_valid'] = False
        validation_result['errors'].append("Filename is required")
    
    # Validate file size (max 50MB)
    max_size_bytes = 50 * 1024 * 1024  # 50MB
    if hasattr(file, 'size') and file.size and file.size > max_size_bytes:
        validation_result['is_valid'] = False
        validation_result['errors'].append(f"File size exceeds maximum limit of 50MB")
    
    # Validate MIME type
    allowed_mime_types = [
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/jpg'
    ]
    
    if file.content_type not in allowed_mime_types:
        validation_result['is_valid'] = False
        validation_result['errors'].append(f"Unsupported file type: {file.content_type}. Allowed types: {', '.join(allowed_mime_types)}")
    
    # Validate filename extension
    if file.filename:
        allowed_extensions = ['.pdf', '.png', '.jpg', '.jpeg']
        file_extension = file.filename.lower()
        if not any(file_extension.endswith(ext) for ext in allowed_extensions):
            validation_result['is_valid'] = False
            validation_result['errors'].append(f"Unsupported file extension. Allowed extensions: {', '.join(allowed_extensions)}")
    
    return validation_result

def validate_value_comparison_request(seller_id: str, sku: str) -> Tuple[bool, List[str]]:
    """
    Validate value comparison request
    
    Args:
        seller_id: Seller identifier
        sku: SKU to compare
        
    Returns:
        Tuple of (is_valid, list_of_issues)
    """
    issues = []
    
    # Validate seller_id
    if not seller_id or not seller_id.strip():
        issues.append("Seller ID is required")
    
    # Validate SKU
    if not sku or not sku.strip():
        issues.append("SKU is required")
    elif len(sku) < 3:
        issues.append("SKU must be at least 3 characters long")
    elif len(sku) > 50:
        issues.append("SKU must be no more than 50 characters long")
    
    # Check for invalid characters
    if sku and not re.match(r'^[A-Za-z0-9\-_]+$', sku):
        issues.append("SKU contains invalid characters. Only alphanumeric, hyphens, and underscores are allowed")
    
    is_valid = len(issues) == 0
    return is_valid, issues

def validate_batch_comparison_request(request: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Validate batch value comparison request
    
    Args:
        request: Request data
        
    Returns:
        Tuple of (is_valid, list_of_issues)
    """
    issues = []
    
    # Validate seller_id
    seller_id = request.get('seller_id')
    if not seller_id or not seller_id.strip():
        issues.append("Seller ID is required")
    
    # Validate skus list
    skus = request.get('skus', [])
    if not skus or not isinstance(skus, list):
        issues.append("SKUs must be a non-empty list")
    elif len(skus) == 0:
        issues.append("SKUs list cannot be empty")
    elif len(skus) > 200:
        issues.append("Maximum 200 SKUs allowed per batch request")
    else:
        # Validate individual SKUs
        for i, sku in enumerate(skus):
            if not isinstance(sku, str):
                issues.append(f"SKU at index {i} must be a string")
            elif not sku.strip():
                issues.append(f"SKU at index {i} cannot be empty")
            elif len(sku) < 3:
                issues.append(f"SKU at index {i} must be at least 3 characters long")
            elif len(sku) > 50:
                issues.append(f"SKU at index {i} must be no more than 50 characters long")
            elif not re.match(r'^[A-Za-z0-9\-_]+$', sku):
                issues.append(f"SKU at index {i} contains invalid characters")
    
    is_valid = len(issues) == 0
    return is_valid, issues

def validate_landed_cost_request(request: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Validate landed cost calculation request
    
    Args:
        request: Request data
        
    Returns:
        Tuple of (is_valid, list_of_issues)
    """
    issues = []
    
    # Validate invoice_data
    invoice_data = request.get('invoice_data')
    if not invoice_data:
        issues.append("Invoice data is required")
    elif not isinstance(invoice_data, dict):
        issues.append("Invoice data must be a dictionary")
    else:
        # Validate line items
        line_items = invoice_data.get('line_items', [])
        if not line_items or not isinstance(line_items, list):
            issues.append("Invoice must contain line items")
        else:
            for i, item in enumerate(line_items):
                if not isinstance(item, dict):
                    issues.append(f"Line item at index {i} must be a dictionary")
                else:
                    # Check required fields
                    if not item.get('unit_cost'):
                        issues.append(f"Line item at index {i} missing unit cost")
                    if not item.get('quantity'):
                        issues.append(f"Line item at index {i} missing quantity")
                    if not item.get('mapped_sku') and not item.get('raw_sku'):
                        issues.append(f"Line item at index {i} missing SKU")
    
    # Validate seller_policy if provided
    seller_policy = request.get('seller_policy')
    if seller_policy and isinstance(seller_policy, dict):
        # Validate percentage fields
        percentage_fields = ['freight_pct', 'duties_pct', 'prep_pct', 'other_pct']
        for field in percentage_fields:
            if field in seller_policy:
                value = seller_policy[field]
                if not isinstance(value, (int, float)):
                    issues.append(f"Seller policy {field} must be a number")
                elif value < 0 or value > 100:
                    issues.append(f"Seller policy {field} must be between 0 and 100")
    
    is_valid = len(issues) == 0
    return is_valid, issues

def validate_sku_mapping_request(request: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Validate SKU mapping request
    
    Args:
        request: Request data
        
    Returns:
        Tuple of (is_valid, list_of_issues)
    """
    issues = []
    
    # Validate skus list
    skus = request.get('skus', [])
    if not skus or not isinstance(skus, list):
        issues.append("SKUs must be a non-empty list")
    elif len(skus) == 0:
        issues.append("SKUs list cannot be empty")
    else:
        # Validate individual SKUs
        for i, sku in enumerate(skus):
            if not isinstance(sku, str):
                issues.append(f"SKU at index {i} must be a string")
            elif not sku.strip():
                issues.append(f"SKU at index {i} cannot be empty")
    
    # Validate catalog_data
    catalog_data = request.get('catalog_data')
    if not catalog_data:
        issues.append("Catalog data is required")
    elif not isinstance(catalog_data, dict):
        issues.append("Catalog data must be a dictionary")
    
    is_valid = len(issues) == 0
    return is_valid, issues

def validate_invoice_date(date_string: str) -> Tuple[bool, List[str]]:
    """
    Validate invoice date format
    
    Args:
        date_string: Date string to validate
        
    Returns:
        Tuple of (is_valid, list_of_issues)
    """
    issues = []
    
    if not date_string:
        return True, []  # Optional field
    
    # Check format (YYYY-MM-DD)
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', date_string):
        issues.append("Invoice date must be in YYYY-MM-DD format")
        return False, issues
    
    try:
        # Parse date to check if it's valid
        from datetime import datetime
        parsed_date = datetime.strptime(date_string, '%Y-%m-%d')
        
        # Check if date is not in the future
        if parsed_date > datetime.now():
            issues.append("Invoice date cannot be in the future")
        
        # Check if date is not too old (e.g., more than 10 years ago)
        from datetime import timedelta
        ten_years_ago = datetime.now() - timedelta(days=3650)
        if parsed_date < ten_years_ago:
            issues.append("Invoice date cannot be more than 10 years ago")
            
    except ValueError:
        issues.append("Invalid invoice date")
    
    is_valid = len(issues) == 0
    return is_valid, issues

def validate_currency(currency: str) -> Tuple[bool, List[str]]:
    """
    Validate currency code
    
    Args:
        currency: Currency code to validate
        
    Returns:
        Tuple of (is_valid, list_of_issues)
    """
    issues = []
    
    if not currency:
        return True, []  # Optional field
    
    # Check if it's a valid 3-letter currency code
    if not re.match(r'^[A-Z]{3}$', currency):
        issues.append("Currency must be a 3-letter currency code (e.g., USD, EUR, GBP)")
    
    # Check against common currency codes
    common_currencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY']
    if currency not in common_currencies:
        issues.append(f"Currency {currency} is not in the list of supported currencies")
    
    is_valid = len(issues) == 0
    return is_valid, issues

def sanitize_filename(filename: str) -> str:
    """
    Sanitize filename for safe storage
    
    Args:
        filename: Original filename
        
    Returns:
        Sanitized filename
    """
    if not filename:
        return "unnamed_file"
    
    # Remove or replace unsafe characters
    sanitized = re.sub(r'[<>:"/\\|?*]', '_', filename)
    
    # Remove leading/trailing dots and spaces
    sanitized = sanitized.strip('. ')
    
    # Limit length
    if len(sanitized) > 200:
        name, ext = sanitized.rsplit('.', 1) if '.' in sanitized else (sanitized, '')
        sanitized = name[:200-len(ext)-1] + ('.' + ext if ext else '')
    
    return sanitized or "unnamed_file"
