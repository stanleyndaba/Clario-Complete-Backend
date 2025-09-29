# Temporary image parser - functionality disabled due to Pillow removal
OCR_AVAILABLE = False

class ImageParser:
    def __init__(self):
        self.ocr_available = OCR_AVAILABLE
    
    def extract_text(self, image_path: str) -> str:
        return \"Image text extraction temporarily disabled. Pillow dependency removed for Python 3.13 compatibility.\"
