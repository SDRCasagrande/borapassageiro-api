import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = new Hono();

// CORS para permitir chamadas do frontend
app.use('/*', cors({
    origin: ['https://borapassageiro.com', 'https://www.borapassageiro.com', 'http://localhost:5173', 'http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
}));

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'bora-passageiro-api' }));

// Track event (visit or click)
app.post('/api/track', async (c) => {
    try {
        const body = await c.req.json();
        const { type } = body;

        // Validate type
        const validTypes = ['visit', 'click_playstore', 'click_appstore', 'click_whatsapp'];
        if (!validTypes.includes(type)) {
            return c.json({ error: 'Invalid event type' }, 400);
        }

        // Get user agent and referer from headers
        const userAgent = c.req.header('user-agent') || null;
        const referer = c.req.header('referer') || null;

        await prisma.analyticsEvent.create({
            data: {
                type,
                userAgent,
                referer,
            },
        });

        return c.json({ success: true });
    } catch (error) {
        console.error('Track error:', error);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

// Get aggregated stats for dashboard
app.get('/api/stats', async (c) => {
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
