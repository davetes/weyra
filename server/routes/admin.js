const express = require('express');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { Decimal } = require('decimal.js');

const prisma = new PrismaClient();
const router = express.Router();

const PERMS = {
    players_read: 'players.read',
    players_ban: 'players.ban',
    admins_manage: 'admins.manage',
    settings_read: 'settings.read',
    settings_write: 'settings.write',
    deposit_read: 'deposit.read',
    deposit_decide: 'deposit.decide',
    withdraw_read: 'withdraw.read',
    withdraw_decide: 'withdraw.decide',
};

function parsePermissions(adminUser) {
    try {
        const permsRaw = adminUser && adminUser.permissions ? adminUser.permissions : '[]';
        const arr = JSON.parse(permsRaw);
        return Array.isArray(arr) ? arr.map(String) : [];
    } catch (_) {
        return [];
    }
}

function hasPerm(adminUser, perm) {
    if (!adminUser) return false;
    if (adminUser.role === 'super_admin') return true;
    const perms = parsePermissions(adminUser);
    return perms.includes(perm);
}

function requirePerm(perm) {
    return (req, res, next) => {
        if (!hasPerm(req.adminUser, perm)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        return next();
    };
}

function serializePlayer(player) {
    return {
        ...player,
        telegramId: player.telegramId != null ? String(player.telegramId) : null,
    };
}

function serializeDepositRequest(row) {
    return {
        ...row,
        telegramId: row.telegramId != null ? String(row.telegramId) : null,
    };
}

function serializeWithdrawRequest(row) {
    return {
        ...row,
        telegramId: row.telegramId != null ? String(row.telegramId) : null,
    };
}

function nowPlusDays(days) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

function makePasswordHash(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, passwordHash) {
    if (!passwordHash || typeof passwordHash !== 'string') return false;
    const parts = passwordHash.split('$');
    if (parts.length !== 3) return false;
    const [algo, salt, hash] = parts;
    if (algo !== 'scrypt') return false;
    const nextHash = hashPassword(password, salt);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(nextHash, 'hex'));
}

function makeSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function getSessionFromReq(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
    if (!token) return null;

    const session = await prisma.adminSession.findUnique({
        where: { token },
        include: { admin: true },
    });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return null;

    return session;
}

function requireAuth() {
    return async(req, res, next) => {
        try {
            const session = await getSessionFromReq(req);
            if (!session) return res.status(401).json({ ok: false, error: 'Unauthorized' });
            req.adminSession = session;
            req.adminUser = session.admin;
            return next();
        } catch (err) {
            console.error('admin auth error:', err);
            return res.status(500).json({ ok: false, error: 'Internal server error' });
        }
    };
}

function requireRole(roles) {
    const set = new Set(Array.isArray(roles) ? roles : [roles]);
    return (req, res, next) => {
        const role = req.adminUser ? req.adminUser.role : null;
        if (!role || !set.has(role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        return next();
    };
}

router.post('/bootstrap', async(req, res) => {
    try {
        const { token, username, password } = req.body || {};
        if (!token || token !== process.env.SUPER_ADMIN_BOOTSTRAP_TOKEN) {
            return res.status(403).json({ ok: false, error: 'Invalid bootstrap token' });
        }
        if (!username || !password) {
            return res.status(400).json({ ok: false, error: 'Missing username or password' });
        }

        const existingSuper = await prisma.adminUser.findFirst({ where: { role: 'super_admin' } });
        if (existingSuper) {
            return res.status(409).json({ ok: false, error: 'Super admin already exists' });
        }

        const admin = await prisma.adminUser.create({
            data: {
                username: String(username).trim(),
                passwordHash: makePasswordHash(String(password)),
                role: 'super_admin',
            },
            select: { id: true, username: true, role: true, permissions: true, createdAt: true },
        });

        return res.json({ ok: true, admin: {...admin, permissions: parsePermissions(admin) } });
    } catch (err) {
        console.error('bootstrap error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

router.post('/login', async(req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) return res.status(400).json({ ok: false, error: 'Missing username or password' });

        const admin = await prisma.adminUser.findUnique({ where: { username: String(username).trim() } });
        if (!admin || !verifyPassword(String(password), admin.passwordHash)) {
            return res.status(401).json({ ok: false, error: 'Invalid credentials' });
        }

        const token = makeSessionToken();
        const session = await prisma.adminSession.create({
            data: {
                token,
                adminId: admin.id,
                expiresAt: nowPlusDays(14),
            },
            select: { token: true, expiresAt: true },
        });

        return res.json({ ok: true, token: session.token, expiresAt: session.expiresAt, admin: { id: admin.id, username: admin.username, role: admin.role, permissions: parsePermissions(admin) } });
    } catch (err) {
        console.error('login error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

router.get('/me', requireAuth(), async(req, res) => {
    return res.json({ ok: true, admin: { id: req.adminUser.id, username: req.adminUser.username, role: req.adminUser.role, permissions: parsePermissions(req.adminUser) } });
});

router.get('/players', requireAuth(), requirePerm(PERMS.players_read), async(req, res) => {
    try {
        const q = String(req.query.q || '').trim();

        const where = q ?
            {
                OR: [
                    { username: { contains: q, mode: 'insensitive' } },
                    { phone: { contains: q, mode: 'insensitive' } },
                ],
            } :
            undefined;

        const players = await prisma.player.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 500,
            select: {
                id: true,
                telegramId: true,
                username: true,
                phone: true,
                wallet: true,
                gift: true,
                wins: true,
                bannedAt: true,
                banReason: true,
                createdAt: true,
            },
        });
        return res.json({ ok: true, players: players.map(serializePlayer) });
    } catch (err) {
        console.error('players error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

router.patch('/players/:id/ban', requireAuth(), requirePerm(PERMS.players_ban), async(req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const reason = String((req.body && req.body.reason) || '');
        if (!id) return res.status(400).json({ ok: false, error: 'Invalid player id' });

        const player = await prisma.player.update({
            where: { id },
            data: { bannedAt: new Date(), banReason: reason },
            select: { id: true, bannedAt: true, banReason: true },
        });
        return res.json({ ok: true, player });
    } catch (err) {
        console.error('ban error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

router.patch('/players/:id/unban', requireAuth(), requirePerm(PERMS.players_ban), async(req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ ok: false, error: 'Invalid player id' });

        const player = await prisma.player.update({
            where: { id },
            data: { bannedAt: null, banReason: '' },
            select: { id: true, bannedAt: true, banReason: true },
        });
        return res.json({ ok: true, player });
    } catch (err) {
        console.error('unban error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

router.get('/admins', requireAuth(), requireRole(['super_admin']), async(req, res) => {
    try {
        const admins = await prisma.adminUser.findMany({
            orderBy: { createdAt: 'desc' },
            select: { id: true, username: true, role: true, permissions: true, createdAt: true },
        });
        const mapped = admins.map((a) => ({...a, permissions: parsePermissions(a) }));
        return res.json({ ok: true, admins: mapped });
    } catch (err) {
        console.error('admins list error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

router.post('/admins', requireAuth(), requireRole(['super_admin']), async(req, res) => {
    try {
        const { username, password, role, permissions } = req.body || {};
        if (!username || !password || !role) return res.status(400).json({ ok: false, error: 'Missing username, password, or role' });

        const normalizedRole = String(role).trim();
        if (!['admin', 'entertainer', 'super_admin'].includes(normalizedRole)) {
            return res.status(400).json({ ok: false, error: 'Invalid role' });
        }
        if (normalizedRole === 'super_admin') {
            return res.status(400).json({ ok: false, error: 'Cannot create another super_admin' });
        }

        const nextPerms = Array.isArray(permissions) ?
            permissions.map(String).filter(Boolean) :
            [];

        const admin = await prisma.adminUser.create({
            data: {
                username: String(username).trim(),
                passwordHash: makePasswordHash(String(password)),
                role: normalizedRole,
                permissions: JSON.stringify(nextPerms),
            },
            select: { id: true, username: true, role: true, permissions: true, createdAt: true },
        });
        return res.json({ ok: true, admin: {...admin, permissions: parsePermissions(admin) } });
    } catch (err) {
        if (err && err.code === 'P2002') {
            return res.status(409).json({ ok: false, error: 'Username already exists' });
        }
        console.error('admins create error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

router.patch('/admins/:id', requireAuth(), requireRole(['super_admin']), async(req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ ok: false, error: 'Invalid admin id' });

        const admin = await prisma.adminUser.findUnique({ where: { id } });
        if (!admin) return res.status(404).json({ ok: false, error: 'Not found' });
        if (admin.role === 'super_admin') return res.status(400).json({ ok: false, error: 'Cannot edit super_admin' });

            const permissions = Array.isArray(req.body && req.body.permissions)
                ? req.body.permissions.map(String).filter(Boolean)
                : null;
        if (!permissions) return res.status(400).json({ ok: false, error: 'Missing permissions' });

        const updated = await prisma.adminUser.update({
            where: { id },
            data: { permissions: JSON.stringify(permissions) },
            select: { id: true, username: true, role: true, permissions: true, createdAt: true },
        });

        return res.json({ ok: true, admin: {...updated, permissions: parsePermissions(updated) } });
    } catch (err) {
        console.error('admins update error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

router.delete('/admins/:id', requireAuth(), requireRole(['super_admin']), async(req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ ok: false, error: 'Invalid admin id' });

        const admin = await prisma.adminUser.findUnique({ where: { id } });
        if (!admin) return res.status(404).json({ ok: false, error: 'Not found' });
        if (admin.role === 'super_admin') return res.status(400).json({ ok: false, error: 'Cannot delete super_admin' });

        await prisma.adminSession.updateMany({ where: { adminId: id }, data: { revokedAt: new Date() } });
        await prisma.adminUser.delete({ where: { id } });

        return res.json({ ok: true });
    } catch (err) {
        console.error('admins delete error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

router.get('/settings', requireAuth(), requirePerm(PERMS.settings_read), async(req, res) => {
    try {
        const settings = await prisma.appSetting.findMany({ orderBy: { key: 'asc' }, select: { key: true, value: true, updatedAt: true } });
        return res.json({ ok: true, settings });
    } catch (err) {
        console.error('settings list error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

router.put('/settings', requireAuth(), requirePerm(PERMS.settings_write), async(req, res) => {
    try {
        const settings = req.body && Array.isArray(req.body.settings) ? req.body.settings : null;
        if (!settings) return res.status(400).json({ ok: false, error: 'Missing settings' });

        for (const row of settings) {
            const key = String((row && row.key) || '').trim();
            const value = String((row && row.value) || '');
            if (!key) continue;

            await prisma.appSetting.upsert({
                where: { key },
                create: { key, value },
                update: { value },
            });
        }

        const next = await prisma.appSetting.findMany({ orderBy: { key: 'asc' }, select: { key: true, value: true, updatedAt: true } });
        return res.json({ ok: true, settings: next });
    } catch (err) {
        console.error('settings save error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

router.get('/deposit_requests', requireAuth(), requirePerm(PERMS.deposit_read), async(req, res) => {
    try {
        const status = String(req.query.status || 'pending');
        const where = status ? { status } : undefined;
        const rows = await prisma.depositRequest.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 500,
            include: { player: { select: { id: true, username: true, phone: true, wallet: true } } },
        });
        return res.json({ ok: true, requests: rows.map(serializeDepositRequest) });
    } catch (err) {
        console.error('deposit_requests list error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

router.patch('/deposit_requests/:id/decide', requireAuth(), requirePerm(PERMS.deposit_decide), async(req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const decision = String((req.body && req.body.decision) || '').toLowerCase();
        const amountRaw = req.body ? req.body.amount : undefined;
        const note = String((req.body && req.body.note) || '');
        if (!id) return res.status(400).json({ ok: false, error: 'Invalid request id' });
        if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ ok: false, error: 'Invalid decision' });

        const existing = await prisma.depositRequest.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
        if (existing.status !== 'pending') return res.status(409).json({ ok: false, error: 'Request already decided' });

        let amountDec = null;
        if (decision === 'approved') {
            if (existing.amount != null) {
                amountDec = new Decimal(existing.amount.toString());
            } else {
                try { amountDec = new Decimal(String(amountRaw)); } catch (_) { amountDec = null; }
                if (!amountDec || amountDec.lte(0)) return res.status(400).json({ ok: false, error: 'Missing or invalid amount' });
            }
        }

        const updated = await prisma.$transaction(async (tx) => {
            const reqRow = await tx.depositRequest.update({
                where: { id },
                data: {
                    status: decision,
                    decidedAt: new Date(),
                    decidedByAdminId: req.adminUser.id,
                    decisionNote: note,
                    amount: amountDec ? amountDec.toNumber() : undefined,
                },
                include: { player: { select: { id: true, username: true, phone: true, wallet: true } } },
            });

            if (decision === 'approved' && amountDec) {
                await tx.player.update({
                    where: { id: reqRow.playerId },
                    data: { wallet: { increment: amountDec.toNumber() } },
                });

                await tx.transaction.create({
                    data: {
                        playerId: reqRow.playerId,
                        kind: 'deposit',
                        amount: amountDec.toNumber(),
                        note: `Deposit approved by ${req.adminUser.username} (#${req.adminUser.id})` + (note ? `: ${note}` : ''),
                    },
                });
            }

            return reqRow;
        });

        return res.json({ ok: true, request: serializeDepositRequest(updated) });
    } catch (err) {
        console.error('deposit_requests decide error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

router.get('/withdraw_requests', requireAuth(), requirePerm(PERMS.withdraw_read), async(req, res) => {
    try {
        const status = String(req.query.status || 'pending');
        const where = status ? { status } : undefined;
        const rows = await prisma.withdrawRequest.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 500,
            include: { player: { select: { id: true, username: true, phone: true, wallet: true } } },
        });
        return res.json({ ok: true, requests: rows.map(serializeWithdrawRequest) });
    } catch (err) {
        console.error('withdraw_requests list error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

router.patch('/withdraw_requests/:id/decide', requireAuth(), requirePerm(PERMS.withdraw_decide), async(req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const decision = String((req.body && req.body.decision) || '').toLowerCase();
        const note = String((req.body && req.body.note) || '');
        if (!id) return res.status(400).json({ ok: false, error: 'Invalid request id' });
        if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ ok: false, error: 'Invalid decision' });

        const existing = await prisma.withdrawRequest.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });
        if (existing.status !== 'pending') return res.status(409).json({ ok: false, error: 'Request already decided' });

        const updated = await prisma.$transaction(async(tx) => {
            const reqRow = await tx.withdrawRequest.update({
                where: { id },
                data: {
                    status: decision,
                    decidedAt: new Date(),
                    decidedByAdminId: req.adminUser.id,
                    decisionNote: note,
                },
                include: { player: { select: { id: true, username: true, phone: true, wallet: true } } },
            });

            if (decision === 'approved') {
                const amountDec = new Decimal(reqRow.amount.toString());
                const player = await tx.player.findUnique({ where: { id: reqRow.playerId } });
                if (!player) throw new Error('Player not found');
                const walletDec = new Decimal(player.wallet.toString());
                if (walletDec.lt(amountDec)) {
                    throw new Error('Insufficient wallet balance to approve withdrawal');
                }

                await tx.player.update({
                    where: { id: reqRow.playerId },
                    data: { wallet: { decrement: amountDec.toNumber() } },
                });

                await tx.transaction.create({
                    data: {
                        playerId: reqRow.playerId,
                        kind: 'withdraw',
                        amount: amountDec.negated().toNumber(),
                        note: `Withdraw approved by ${req.adminUser.username} (#${req.adminUser.id})` + (note ? `: ${note}` : ''),
                    },
                });
            }

            return reqRow;
        });

        return res.json({ ok: true, request: serializeWithdrawRequest(updated) });
    } catch (err) {
        if (String((err && err.message) || '').includes('Insufficient wallet balance')) {
            return res.status(400).json({ ok: false, error: err.message });
        }
        console.error('withdraw_requests decide error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

module.exports = router;