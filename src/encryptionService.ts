import * as crypto from 'crypto';

export class EncryptionService {
    private algorithm = 'aes-256-gcm';
    private salt = 'xnotes_salt';

    encrypt(text: string, password: string): string {
        const key = crypto.scryptSync(password, this.salt, 32);
        const iv = crypto.randomBytes(12);

        // Type assertion for CipherGCM
        const cipher = crypto.createCipheriv(this.algorithm, key, iv) as crypto.CipherGCM;

        const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();

        return JSON.stringify({
            iv: iv.toString('hex'),
            content: encrypted.toString('hex'),
            tag: authTag.toString('hex')
        });
    }

    decrypt(encryptedData: string, password: string): string {
        try {
            const data = JSON.parse(encryptedData);
            const key = crypto.scryptSync(password, this.salt, 32);
            const iv = Buffer.from(data.iv, 'hex');
            const encryptedText = Buffer.from(data.content, 'hex');
            const tag = Buffer.from(data.tag, 'hex');

            // Type assertion for DecipherGCM
            const decipher = crypto.createDecipheriv(this.algorithm, key, iv) as crypto.DecipherGCM;
            decipher.setAuthTag(tag);

            const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
            return decrypted.toString('utf8');
        } catch (error) {
            throw new Error('Failed to decrypt. Invalid password or corrupted file.');
        }
    }
}
