export interface EmailTemplate {
    subject: string;
    html: string;
    text?: string;
}
export interface EmailOptions {
    to: string;
    from?: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
}
declare class EmailService {
    private ses;
    private sendGrid;
    private templatesPath;
    constructor();
    private initializeEmailProvider;
    private initializeSES;
    private initializeSendGrid;
    loadTemplate(templateName: string): Promise<string>;
    private replacePlaceholders;
    sendEmail(options: EmailOptions): Promise<boolean>;
    private sendViaSES;
    private sendViaSendGrid;
    sendTemplatedEmail(to: string, templateName: string, data: Record<string, any>, subject?: string): Promise<boolean>;
    private extractSubjectFromTemplate;
    validateEmail(email: string): Promise<boolean>;
    getSendQuota(): Promise<any>;
}
export declare const emailService: EmailService;
export default emailService;
//# sourceMappingURL=email.service.d.ts.map