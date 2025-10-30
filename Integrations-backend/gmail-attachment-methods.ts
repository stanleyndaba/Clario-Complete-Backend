  async downloadAttachment(userId: string, messageId: string, attachmentId: string): Promise<Buffer> {
    try {
      const accessToken = await this.getValidAccessToken(userId);
      
      const response = await axios.get(
        \\/messages/\/attachments/\\,
        {
          headers: { Authorization: \Bearer \\ },
          responseType: 'arraybuffer'
        }
      );
      
      const attachmentData = response.data;
      return Buffer.from(attachmentData, 'binary');
    } catch (error) {
      logger.error('Error downloading Gmail attachment', { error, userId, messageId, attachmentId });
      throw createError('Failed to download attachment', 500);
    }
  }

  async getEmailAttachments(userId: string, messageId: string): Promise<any[]> {
    try {
      const accessToken = await this.getValidAccessToken(userId);
      
      const response = await axios.get(\\/messages/\\, {
        headers: { Authorization: \Bearer \\ },
        params: { format: 'full' }
      });

      const emailData = response.data;
      const attachments = [];
      
      const findAttachments = (parts: any[]) => {
        for (const part of parts) {
          if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
            attachments.push({
              id: part.body.attachmentId,
              filename: part.filename,
              mimeType: part.mimeType,
              size: part.body.size
            });
          }
          if (part.parts) {
            findAttachments(part.parts);
          }
        }
      };

      if (emailData.payload.parts) {
        findAttachments(emailData.payload.parts);
      }
      
      return attachments;
    } catch (error) {
      logger.error('Error fetching email attachments', { error, userId, messageId });
      throw createError('Failed to fetch email attachments', 500);
    }
  }

  async processEmailAttachments(userId: string, messageId: string): Promise<void> {
    try {
      const attachments = await this.getEmailAttachments(userId, messageId);
      
      for (const attachment of attachments) {
        try {
          const fileBuffer = await this.downloadAttachment(userId, messageId, attachment.id);
          const parsedData = await this.sendToParserService(userId, fileBuffer, attachment.filename);
          
          if (parsedData) {
            await this.storeParsedEvidence(userId, messageId, parsedData, attachment.filename);
          }
        } catch (error) {
          logger.warn('Failed to process attachment', { 
            attachment: attachment.filename, 
            error 
          });
        }
      }
    } catch (error) {
      logger.error('Error processing email attachments', { error, userId, messageId });
      throw createError('Failed to process email attachments', 500);
    }
  }

  private async sendToParserService(userId: string, fileBuffer: Buffer, filename: string): Promise<any> {
    try {
      const parserUrl = 'http://localhost:8000/api/v1/evidence/parse/document';
      
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', fileBuffer, { filename });
      formData.append('user_id', userId);
      formData.append('filename', filename);

      const response = await axios.post(parserUrl, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        timeout: 30000
      });

      return response.data;
    } catch (error) {
      logger.error('Error sending to parser service', { error, userId, filename });
      throw createError('Failed to parse document', 500);
    }
  }

  private async storeParsedEvidence(userId: string, messageId: string, parsedData: any, filename: string): Promise<void> {
    try {
      const { evidenceIngestionService } = await import('./evidenceIngestionService');
      
      const parsedDoc = {
        doc_type: parsedData.doc_type || 'invoice',
        supplier_name: parsedData.supplier_name,
        invoice_number: parsedData.invoice_number,
        purchase_order_number: parsedData.purchase_order_number,
        document_date: parsedData.document_date,
        currency: parsedData.currency,
        total_amount: parsedData.total_amount,
        file_url: filename,
        raw_text: parsedData.raw_text,
        items: parsedData.items || []
      };

      await evidenceIngestionService.ingestParsedDocument(userId, null, parsedDoc);
      
      logger.info('Successfully stored parsed evidence', { userId, messageId, filename });
    } catch (error) {
      logger.error('Error storing parsed evidence', { error, userId, messageId });
      throw createError('Failed to store parsed evidence', 500);
    }
  }
