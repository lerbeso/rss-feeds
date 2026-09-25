const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const cheerio = require('cheerio');
const pLimit = require('p-limit');

// Fonction pour récupérer le contenu complet d'un article (contournement paywall "dur")
async function fetchFullArticle(url, selectors) {
    try {
        const res = await fetch(url);
        const html = await res.text();
        const $ = cheerio.load(html);

        let fullContent = '';
        for (const selector of selectors) {
            const $block = $(selector);
            if ($block.length > 0) {
                // .html() fonctionne même si l'élément a l'attribut hidden
                fullContent += $block.html() || '';
            }
        }

        if (!fullContent.trim()) {
            return null;
        }

        // Nettoyage : retirer scripts, styles, iframes, pubs
        const $content = cheerio.load(fullContent);
        $content('script, style, iframe, ins, .ad, .ads, .advertisement, [class*="pub"], [class*="ad-"]').remove();

        return $content.html();
    } catch (err) {
        console.error(`   ⚠️ Impossible de récupérer ${url}:`, err.message);
        return null;
    }
}

async function generateOneFeed(config) {
    const res = await fetch(config.url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const items = [];
    const currentYear = new Date().getFullYear();

    $(config.selector).each((i, el) => {
        const $el = $(el);

        // Cas particulier : si le sélecteur cible directement un <a>
        const isAnchor = $el.is('a');

        const $titleEl = config.title_selector ? $el.find(config.title_selector) : $el;
        const title = $titleEl.text().trim();

        let link = '';
        if (config.link_selector) {
            link = $el.find(config.link_selector).attr(config.link_attribute) || '';
        } else if (isAnchor) {
            link = $el.attr(config.link_attribute) || '';
        } else {
            link = $el.find('a').first().attr(config.link_attribute) || '';
        }

        if (link && !link.startsWith('http')) {
            link = new URL(link, config.url).href;
        }

        // Date (optionnelle)
        let pubDate = new Date().toUTCString();
        if (config.date_selector) {
            const dateText = $el.find(config.date_selector).text().trim();
            const dateMatch = dateText.match(/(\d{2})\/(\d{2})\s*-\s*(\d{2}):(\d{2})/);
            if (dateMatch) {
                const [, day, month, hour, minute] = dateMatch;
                pubDate = new Date(currentYear, month - 1, day, hour, minute).toUTCString();
            }
        }

        // Description / extrait
        let description = '';
        if (config.preview_selector) {
            description = $el.find(config.preview_selector).text().trim();
        }
        if (!description) {
            description = title;
        }

        // Image
        let imageUrl = '';
        if (config.image_selector) {
            imageUrl = $el.find(config.image_selector).attr(config.image_attribute) || '';
        }

        if (title && link) {
            items.push({ title, link, description, pubDate, imageUrl });
        }
    });

    // Récupération du contenu complet si demandé
    if (config.full_article && config.full_article_selectors) {
        console.log(`   📥 Récupération du contenu complet de ${items.length} articles...`);
        const articleLimit = pLimit(2); // max 2 en parallèle pour ne pas surcharger le site

        let count = 0;
        await Promise.all(items.map(item =>
            articleLimit(async () => {
                const fullContent = await fetchFullArticle(
                    item.link,
                    config.full_article_selectors
                );
                if (fullContent) {
                    item.description = fullContent;
                }
                count++;
                console.log(`   → ${count}/${items.length} : ${item.title.substring(0, 60)}...`);
            })
        ));
    }

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
