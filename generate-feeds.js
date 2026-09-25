const pLimit = require('p-limit');const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const cheerio = require('cheerio');
const pLimit = require('p-limit');

async function generateOneFeed(config) {
    const res = await fetch(config.url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const items = [];
    const currentYear = new Date().getFullYear();

    $(config.selector).each((i, el) => {
        const $el = $(el);

        const $titleLink = $el.find(config.title_selector);
        const title = $titleLink.text().trim();
        let link = $titleLink.attr(config.link_attribute) || '';

        if (link && !link.startsWith('http')) {
            link = new URL(link, config.url).href;
        }

        const dateText = $el.find(config.date_selector).text().trim();
        const dateMatch = dateText.match(/(\d{2})\/(\d{2})\s*-\s*(\d{2}):(\d{2})/);
        let pubDate = new Date().toUTCString();
        if (dateMatch) {
            const [, day, month, hour, minute] = dateMatch;
            pubDate = new Date(currentYear, month - 1, day, hour, minute).toUTCString();
        }

        const description = $el.find(config.preview_selector).text().trim() || title;
        const imageUrl = $el.find(config.image_selector).attr(config.image_attribute) || '';

        if (title && link) {
            items.push({ title, link, description, pubDate, imageUrl });
        }
    });

    const rss = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
    <title>${config.name}</title>
    <link>${config.url}</link>
    <description>Flux RSS généré automatiquement pour ${config.name}</description>
    <language>fr-FR</language>
    ${items.map(item => `
    <item>
        <title><![CDATA[${item.title}]]></title>
        <link>${item.link}</link>
        <description><![CDATA[${item.description}]]></description>
        <pubDate>${item.pubDate}</pubDate>
        ${item.imageUrl ? `<media:content url="${item.imageUrl}" medium="image" />` : ''}
        <guid isPermaLink="true">${item.link}</guid>
    </item>`).join('')}
</channel>
</rss>`;

    if (!fs.existsSync('output')) {
        fs.mkdirSync('output');
    }

    fs.writeFileSync(path.join('output', config.output), rss);
    console.log(`✅ ${config.output} : ${items.length} articles générés`);
}

async function main() {
    const feedFiles = fs.readdirSync('feeds')
        .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

    console.log(`📋 ${feedFiles.length} flux à générer`);

    const limit = pLimit(5);

    const tasks = feedFiles.map(file =>
        limit(async () => {
            try {
                const config = yaml.load(
                    fs.readFileSync(path.join('feeds', file), 'utf8')
                );
                await generateOneFeed(config);
            } catch (err) {
                console.error(`❌ Erreur avec ${file}:`, err.message);
            }
        })
    );

    await Promise.all(tasks);
    console.log('🎉 Génération terminée');
}

main().catch(console.error);
