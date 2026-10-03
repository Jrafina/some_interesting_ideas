import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import kvObjService from './service/kv-obj-service';
import oauthService from "./service/oauth-service";
import { buildMailboxHTML, buildErrorPage } from './template/mailbox';
import orm from './entity/orm';
import emailEntity from './entity/email';
import { and, eq, desc } from 'drizzle-orm';
import { isDel, emailConst } from './const/entity-const';
import settingService from './service/setting-service';
import jwtUtils from './utils/jwt-utils';
export default {
	 async fetch(req, env, ctx) {

		const url = new URL(req.url)

		// Mailbox public view route: /mailbox/:email/:token
		if (url.pathname.startsWith('/mailbox/')) {
			try {
				const parts = url.pathname.split('/');
				if (parts.length < 4) {
					return new Response(buildErrorPage('Invalid URL'), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
				}
				const email = decodeURIComponent(parts[2]);
				const token = parts[3];
				if (!email || !token || !email.includes('@')) {
					return new Response(buildErrorPage('Invalid email or token'), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
				}
				// Verify JWT token
				const envCtx = { env };
				const payload = await jwtUtils.verifyToken(envCtx, token);
				if (!payload || payload.email !== email) {
					return new Response(buildErrorPage('Invalid or expired token'), { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
				}
				// Query emails for this mailbox
				const db = orm(envCtx);
				const emailList = await db.select()
					.from(emailEntity)
					.where(and(
						eq(emailEntity.toEmail, email),
						eq(emailEntity.isDel, isDel.NORMAL),
						eq(emailEntity.type, emailConst.type.RECEIVE)
					))
					.orderBy(desc(emailEntity.emailId))
					.limit(100)
					.all();
				const setting = await settingService.query(envCtx);
				const r2Domain = setting.r2Domain || '';
				const html = buildMailboxHTML(email, emailList, r2Domain);
				return new Response(html, {
					status: 200,
					headers: { 'Content-Type': 'text/html; charset=utf-8' }
				});
			} catch (err) {
				console.error('Mailbox view error:', err);
				return new Response(buildErrorPage('An error occurred: ' + (err.message || 'Unknown')), {
					status: 500,
					headers: { 'Content-Type': 'text/html; charset=utf-8' }
				});
			}
		}

		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '')
			req = new Request(url.toString(), req)
			return app.fetch(req, env, ctx);
		}

		 if (['/static/','/attachments/'].some(p => url.pathname.startsWith(p))) {
			 return await kvObjService.toObjResp( { env }, url.pathname.substring(1));
		 }

		return env.assets.fetch(req);
	},
	email: email,
	async scheduled(c, env, ctx) {
		await verifyRecordService.clearRecord({ env })
		await userService.resetDaySendCount({ env })
		await emailService.completeReceiveAll({ env })
		await oauthService.clearNoBindOathUser({ env })
	},
};
