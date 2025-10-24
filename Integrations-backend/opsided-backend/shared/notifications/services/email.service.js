"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = void 0;
const logger_1 = require("../../utils/logger");
const AWS = __importStar(require("aws-sdk"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger = (0, logger_1.getLogger)('EmailService');
class EmailService {
    constructor() {
        this.ses = null;
        this.sendGrid = null;
        this.templatesPath = path.join(__dirname, '../templates/email');
        this.initializeEmailProvider();
    }
    initializeEmailProvider() {
        const emailProvider = process.env.EMAIL_PROVIDER || 'ses';
        if (emailProvider === 'ses') {
            this.initializeSES();
        }
        else if (emailProvider === 'sendgrid') {
            this.initializeSendGrid();
        }
        else {
            logger.warn(`Unsupported email provider: ${emailProvider}`);
        }
    }
    initializeSES() {
        try {
            this.ses = new AWS.SES({
                region: process.env.AWS_REGION || 'us-east-1',
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            });
            logger.info('Initialized AWS SES email service');
        }
        catch (error) {
            logger.error('Failed to initialize AWS SES:', error);
        }
    }
    initializeSendGrid() {
        try {
            const sgMail = require('@sendgrid/mail');
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            this.sendGrid = sgMail;
            logger.info('Initialized SendGrid email service');
        }
        catch (error) {
            logger.error('Failed to initialize SendGrid:', error);
        }
    }
    async loadTemplate(templateName) {
        try {
            const templatePath = path.join(this.templatesPath, `${templateName}.html`);
            const template = fs.readFileSync(templatePath, 'utf8');
            return template;
        }
        catch (error) {
            logger.error(`Failed to load template ${templateName}:`, error);
            throw new Error(`Template ${templateName} not found`);
        }
    }
    replacePlaceholders(template, data) {
        let result = template;
        for (const [key, value] of Object.entries(data)) {
            const placeholder = `{{${key}}}`;
            result = result.replace(new RegExp(placeholder, 'g'), String(value));
        }
        return result;
    }
    async sendEmail(options) {
        try {
            if (this.ses) {
                return await this.sendViaSES(options);
            }
            else if (this.sendGrid) {
                return await this.sendViaSendGrid(options);
            }
            else {
                logger.error('No email provider configured');
                return false;
            }
        }
        catch (error) {
            logger.error('Failed to send email:', error);
            return false;
        }
    }
    async sendViaSES(options) {
        if (!this.ses)
            return false;
        const params = {
            Source: options.from || process.env.SES_FROM_EMAIL || 'noreply@opsided.com',
            Destination: {
                ToAddresses: [options.to],
            },
            Message: {
                Subject: {
                    Data: options.subject,
                    Charset: 'UTF-8',
                },
                Body: {
                    Html: {
                        Data: options.html,
                        Charset: 'UTF-8',
                    },
                    ...(options.text && {
                        Text: {
                            Data: options.text,
                            Charset: 'UTF-8',
                        },
                    }),
                },
            },
            ...(options.replyTo && {
                ReplyToAddresses: [options.replyTo],
            }),
        };
        try {
            const result = await this.ses.sendEmail(params).promise();
            logger.info(`Email sent via SES: ${result.MessageId}`);
            return true;
        }
        catch (error) {
            logger.error('Failed to send email via SES:', error);
            return false;
        }
    }
    async sendViaSendGrid(options) {
        if (!this.sendGrid)
            return false;
        const msg = {
            to: options.to,
            from: options.from || process.env.SENDGRID_FROM_EMAIL || 'noreply@opsided.com',
            subject: options.subject,
            html: options.html,
            ...(options.text && { text: options.text }),
            ...(options.replyTo && { replyTo: options.replyTo }),
        };
        try {
            await this.sendGrid.send(msg);
            logger.info(`Email sent via SendGrid to ${options.to}`);
            return true;
        }
        catch (error) {
            logger.error('Failed to send email via SendGrid:', error);
            return false;
        }
    }
    async sendTemplatedEmail(to, templateName, data, subject) {
        try {
            const template = await this.loadTemplate(templateName);
            const html = this.replacePlaceholders(template, data);
            const emailSubject = subject || this.extractSubjectFromTemplate(template);
            return await this.sendEmail({
                to,
                subject: emailSubject,
                html,
            });
        }
        catch (error) {
            logger.error(`Failed to send templated email ${templateName}:`, error);
            return false;
        }
    }
    extractSubjectFromTemplate(template) {
        const titleMatch = template.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) {
            return titleMatch[1].trim();
        }
        return 'Notification from Opside';
    }
    async validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
    async getSendQuota() {
        if (!this.ses)
            return null;
        try {
            const quota = await this.ses.getSendQuota().promise();
            return quota;
        }
        catch (error) {
            logger.error('Failed to get send quota:', error);
            return null;
        }
    }
}
exports.emailService = new EmailService();
exports.default = exports.emailService;
//# sourceMappingURL=email.service.js.map