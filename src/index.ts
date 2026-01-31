import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { PrismaClient } from '@prisma/client';
import { sign, verify } from 'hono/jwt';

const prisma = new PrismaClient();
const app = new Hono();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// CORS para permitir chamadas do frontend
app.use('/*', cors({
    origin: ['https://borapassageiro.bkaiser.com.br', 'https://borapassageiro.com', 'https://www.borapassageiro.com', 'http://localhost:5173', 'http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'bora-passageiro-api' }));

// Auth Login
app.post('/api/auth/login', async (c) => {
    try {
        const { password } = await c.req.json();

        if (password !== ADMIN_PASSWORD) {
            return c.json({ error: 'Invalid password' }, 401);
        }

        const token = await sign({ role: 'admin', exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 }, JWT_SECRET); // 24h token
        return c.json({ success: true, token });
    } catch (e) {
        return c.json({ error: 'Auth failed' }, 400);
    }
});

// Auth Middleware
async function authMiddleware(c: any, next: any) {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return c.json({ error: 'Unauthorized' }, 401);

    const token = authHeader.split(' ')[1];
    try {
        await verify(token, JWT_SECRET);
        await next();
    } catch (e) {
        return c.json({ error: 'Invalid token' }, 401);
    }
}

// Track event (visit or click) with Geolocation & UTM
app.post('/api/track', async (c) => {
    try {
        const body = await c.req.json();
        const { type, utm_source, utm_medium, utm_campaign } = body;

        // Validate type
        const validTypes = ['visit', 'click_playstore', 'click_appstore', 'click_whatsapp'];
        if (!validTypes.includes(type)) {
            return c.json({ error: 'Invalid event type' }, 400);
        }

        // Get user agent and referer from headers
        const userAgent = c.req.header('user-agent') || null;
        const referer = c.req.header('referer') || null;

        // Geolocation Logic
        let city = null;
        let region = null;
        let country = null;

        try {
            // Get IP (x-forwarded-for handling for Coolify/Nginx)
            const forwarded = c.req.header('x-forwarded-for');
            const ip = forwarded ? forwarded.split(',')[0] : c.req.header('cf-connecting-ip') || '127.0.0.1';

            // Skip local/private IPs to avoid wasting API calls
            if (ip && ip.length > 7 && !ip.startsWith('127.') && !ip.startsWith('192.168.')) {
                const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city`);
                const geoData = await geoRes.json() as any;

                if (geoData.status === 'success') {
                    city = geoData.city;
                    region = geoData.regionName;
                    country = geoData.country;
                }
            }
        } catch (geoError) {
            console.error('Geo lookup failed:', geoError);
        }

        await prisma.analyticsEvent.create({
            data: {
                type,
                userAgent,
                referer,
                city,
                region,
                country,
                utm_source,
                utm_medium,
                utm_campaign
            },
        });

        return c.json({ success: true });
    } catch (error) {
        console.error('Track error:', error);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

// Get aggregated stats for dashboard (Protected)
app.get('/api/stats', authMiddleware, async (c) => {
    try {
        // Get date range from query params (default: last 30 days)
        const days = parseInt(c.req.query('days') || '30');
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Fetch all events in range
        const events = await prisma.analyticsEvent.findMany({
            where: {
                date: {
                    gte: startDate,
                },
            },
            orderBy: {
                date: 'asc',
            },
        });

        // Aggregate by date
        const dailyStats: Record<string, {
            date: string;
            visits: number;
            clicks: { playStore: number; appStore: number; whatsapp: number };
        }> = {};

        // Aggregate Dimensions
        const cityStats: Record<string, number> = {};
        const sourceStats: Record<string, number> = {};

        for (const event of events) {
            const dateKey = event.date.toISOString().split('T')[0];

            if (!dailyStats[dateKey]) {
                dailyStats[dateKey] = {
                    date: dateKey,
                    visits: 0,
                    clicks: { playStore: 0, appStore: 0, whatsapp: 0 },
                };
            }

            if (event.type === 'visit') {
                dailyStats[dateKey].visits += 1;
                // Count cities only for visits
                if (event.city) {
                    const locKey = `${event.city}, ${event.region || ''}`;
                    cityStats[locKey] = (cityStats[locKey] || 0) + 1;
                }
                // Count sources (e.g., "facebook", "google", "direct")
                const source = event.utm_source || 'direto';
                sourceStats[source] = (sourceStats[source] || 0) + 1;

            } else if (event.type === 'click_playstore') {
                dailyStats[dateKey].clicks.playStore += 1;
            } else if (event.type === 'click_appstore') {
                dailyStats[dateKey].clicks.appStore += 1;
            } else if (event.type === 'click_whatsapp') {
                dailyStats[dateKey].clicks.whatsapp += 1;
            }
        }

        // Convert to array and sort
        const result = Object.values(dailyStats).sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        // Top Cities
        const topCities = Object.entries(cityStats)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // Top Sources
        const topSources = Object.entries(sourceStats)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

        // Calculate totals
        const totals = {
            visits: events.filter(e => e.type === 'visit').length,
            playStore: events.filter(e => e.type === 'click_playstore').length,
            appStore: events.filter(e => e.type === 'click_appstore').length,
            whatsapp: events.filter(e => e.type === 'click_whatsapp').length,
        };

        return c.json({
            daily: result,
            totals,
            topCities,
            topSources,
            period: {
                start: startDate.toISOString().split('T')[0],
                end: new Date().toISOString().split('T')[0],
                days,
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

const port = parseInt(process.env.PORT || '3001');

console.log(`🚀 Bora Passageiro API running on port ${port}`);

serve({
    fetch: app.fetch,
    port,
});
