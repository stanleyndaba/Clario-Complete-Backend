# Image Parser - Basic implementation without OCR dependencies

OCR_AVAILABLE = False

class ImageParser:
    @staticmethod
    def extract_text(image_path: str) -> str:
        return 'Image text extraction temporarily disabled. Pillow dependency removed for Python 3.13 compatibility.'

    @staticmethod
    def is_available() -> bool:
        return False
