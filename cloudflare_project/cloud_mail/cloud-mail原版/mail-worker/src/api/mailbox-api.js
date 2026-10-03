import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import userService from '../service/user-service';
import accountService from '../service/account-service';
import settingService from '../service/setting-service';
import jwtUtils from '../utils/jwt-utils';

app.get('/mailbox/genToken/:email', async (c) => {
	const email = c.req.param('email');
	const userId = userContext.getUserId(c);

	if (!userId) {
		return c.json(result.fail('Not logged in', 401));
	}

	const userRow = await userService.selectById(c, userId);
	if (!userRow) {
		return c.json(result.fail('User not found', 401));
	}

	// Verify account exists
	const account = await accountService.selectByEmailIncludeDel(c, email);
	if (!account) {
		return c.json(result.fail('Account not found', 404));
	}

	// Admin can get token for any mailbox; regular users only for their own
	if (userRow.email !== c.env.admin && account.userId !== userId) {
		return c.json(result.fail('Unauthorized', 401));
	}

	// Generate JWT with email in payload (no expiry)
	const token = await jwtUtils.generateToken(c, { email });

	// Construct viewing URL
	const setting = await settingService.query(c);
	const customDomain = setting.customDomain || '';
	let baseUrl = '';
	if (customDomain) {
		baseUrl = 'https://' + customDomain;
	} else if (c.req.header('Host')) {
		baseUrl = 'https://' + c.req.header('Host');
	}

	const viewUrl = baseUrl + '/mailbox/' + encodeURIComponent(email) + '/' + token;

	return c.json(result.ok({ token, url: viewUrl }));
});
