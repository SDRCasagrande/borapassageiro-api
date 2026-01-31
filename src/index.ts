import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { PrismaClient } from '@prisma/client';
import { sign, verify } from 'hono/jwt';
import { FacebookService } from './services/FacebookService';
import { GoogleService } from './services/GoogleService';
import { TikTokService } from './services/TikTokService';

const prisma = new PrismaClient();
const app = new Hono();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// CORS para permitir chamadas do frontend
app.use('/*', cors({
    origin: ['https://borapassageiro.bkaiser.com.br', 'https://borapassageiro.com', 'https://www.borapassageiro.com', 'http://localhost:5173', 'http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
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

// --- CONTENT MANAGEMENT (CMS) ---

// Get Public Content (for Landing Page)
app.get('/api/content/public', async (c) => {
    const content = await prisma.siteContent.findMany({
        where: { isActive: true },
        orderBy: { order: 'asc' }
    });
    return c.json(content);
});

// Get All Content (Admin)
app.get('/api/content', authMiddleware, async (c) => {
    const content = await prisma.siteContent.findMany({
        orderBy: { order: 'asc' }
    });
    return c.json(content);
});

// Create/Update Content
app.post('/api/content', authMiddleware, async (c) => {
    const body = await c.req.json();
    const { id, section, type, title, url, content, isActive, order } = body;

    // Standardize YouTube URLs if needed
    let finalUrl = url;
    if (type === 'youtube' && url) {
        // Extract ID from various YT formats if user pastes full link
        const vidId = url.match(/(?:youtu\.be\/|youtube\.com\/.*v=|embed\/)([^&?]+)/)?.[1];
        if (vidId) finalUrl = vidId; // Store just the ID
    }

    if (id) {
        // Update
        const item = await prisma.siteContent.update({
            where: { id },
            data: { section, type, title, url: finalUrl, content, isActive, order: Number(order) }
        });
        return c.json(item);
    } else {
        // Create
        const item = await prisma.siteContent.create({
            data: { section, type, title, url: finalUrl, content, isActive, order: Number(order) }
        });
        return c.json(item);
    }
});

// Delete Content
app.delete('/api/content/:id', authMiddleware, async (c) => {
    const id = c.req.param('id');
    await prisma.siteContent.delete({ where: { id } });
    return c.json({ success: true });
});

// --- INTEGRATIONS ---
app.get('/api/integrations', authMiddleware, async (c) => {
    const configs = await prisma.integrationConfig.findMany();
    // Convert to simple object { facebook: {...}, google: {...} }
    const result: any = {};
    configs.forEach(conf => {
        result[conf.key] = conf.data;
    });
    return c.json(result);
});

// Save Integration
app.post('/api/integrations', authMiddleware, async (c) => {
    const { key, data } = await c.req.json();

    if (!['facebook', 'google', 'tiktok'].includes(key)) {
        return c.json({ error: 'Invalid key' }, 400);
    }

    const config = await prisma.integrationConfig.upsert({
        where: { key },
        update: { data },
        create: { key, data }
    });

    return c.json(config);
});

// Auth Middleware
async function authMiddleware(c: any, next: any) {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return c.json({ error: 'Unauthorized' }, 401);

    const token = authHeader.split(' ')[1];
    try {
        await verify(token, JWT_SECRET, 'HS256');
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
        let ip = '127.0.0.1';

        try {
            // Get IP (x-forwarded-for handling for Coolify/Nginx)
            const forwarded = c.req.header('x-forwarded-for');
            ip = forwarded ? forwarded.split(',')[0] : c.req.header('cf-connecting-ip') || '127.0.0.1';

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

        // Fetch Integration Configs
        const configs = await prisma.integrationConfig.findMany();
        const fbConfig = configs.find(c => c.key === 'facebook')?.data as any;
        const gaConfig = configs.find(c => c.key === 'google')?.data as any;
        const ttConfig = configs.find(c => c.key === 'tiktok')?.data as any;

        // Fire Ad Tech Events (Async)
        const fbc = c.req.header('fbc') || undefined;
        const fbp = c.req.header('fbp') || undefined;
        const ttclid = c.req.header('ttclid') || undefined;
        const clientId = c.req.header('x-ga-client-id') || undefined;

        // Map events
        if (type !== 'visit') {
            const eventMap: any = {
                'click_whatsapp': 'Lead',
                'click_playstore': 'ViewContent',
                'click_appstore': 'ViewContent'
            };
            const fbEvent = eventMap[type] || 'CustomEvent';
            const ttEvent = type === 'click_whatsapp' ? 'ClickButton' : 'ViewContent'; // Simple mapping for TikTok

            // Facebook CAPI
            if (fbConfig?.accessToken && fbConfig?.pixelId) {
                FacebookService.sendEvent(fbEvent, {
                    content_name: type,
                    city,
                    region,
                    country
                }, { ip, userAgent: userAgent || '', fbc, fbp }, fbConfig);
            }

            // Google GA4
            if (gaConfig?.measurementId && gaConfig?.apiSecret) {
                GoogleService.sendEvent(type, {
                    client_id: clientId,
                    city,
                    region,
                    source: utm_source,
                    medium: utm_medium,
                    campaign: utm_campaign
                }, gaConfig);
            }

            // TikTok Events API
            if (ttConfig?.accessToken && ttConfig?.pixelId) {
                TikTokService.sendEvent(ttEvent, {
                    content_name: type,
                    region
                }, { ip, userAgent: userAgent || '', ttclid }, ttConfig);
            }
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

        return c.json({ success: true, city });
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
