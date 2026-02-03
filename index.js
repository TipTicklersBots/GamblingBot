require('dotenv').config();
const { 
    Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ComponentType 
} = require('discord.js');
const Database = require('better-sqlite3');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers
    ] 
});

const db = new Database('gambling_final.db');

// --- UPDATED ADMIN IDS ---
const ADMIN_IDS = ['1089621049160769676', '1465414780696264870', '1273097786363089008'];

// --- DB SETUP ---
db.prepare(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, balance INTEGER DEFAULT 1000, lastDaily INTEGER DEFAULT 0, streak INTEGER DEFAULT 0, lastWork INTEGER DEFAULT 0, items TEXT DEFAULT '[]')`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, item TEXT, time TEXT)`).run();

try { db.prepare(`ALTER TABLE purchases ADD COLUMN order_id TEXT`).run(); } catch(e) {}
try { db.prepare(`ALTER TABLE purchases ADD COLUMN status TEXT DEFAULT 'PENDING'`).run(); } catch(e) {}

const getUser = (id) => {
    db.prepare(`INSERT OR IGNORE INTO users (id) VALUES (?)`).run(id);
    return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
};

const hasItem = (user, itemName) => {
    try {
        const items = JSON.parse(user.items || '[]');
        return items.some(i => i.name === itemName && i.expires > Date.now());
    } catch (e) { return false; }
};

const generateOrderID = () => {
    return 'TRX-' + Math.random().toString(36).toUpperCase().substring(2, 8);
};

/* ================= LOGGING SYSTEM ================= */
const gameLog = async (guild, user, game, bet, result, color, details) => {
    try {
        const row = db.prepare(`SELECT value FROM config WHERE key = 'game_logs'`).get();
        if (!row) return;
        const channel = guild.channels.cache.get(row.value);
        if (channel) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `${game} Transaction`, iconURL: user.displayAvatarURL() })
                .setDescription(`**User:** ${user} (\`${user.id}\`)\n**Bet Amount:** ${bet.toLocaleString()} 🪙\n**Result:** ${result}\n**Details:** ${details}`)
                .setColor(color)
                .setTimestamp()
                .setFooter({ text: 'Security Audit Log' });
            channel.send({ embeds: [embed] });
        }
    } catch (e) {}
};

/* ================= ADMIN COMMANDS (!...) ================= */
client.on('messageCreate', async m => {
    if (m.author.bot || !ADMIN_IDS.includes(m.author.id)) return;

    if (m.content === '!ap') {
        await m.delete().catch(() => {});
        const apEmbed = new EmbedBuilder()
            .setTitle('🛠️ Admin Control Panel')
            .setDescription('`!addcoins @user amt` | `!log #channel` | `!purchaseall` | `!order <ID>` | `!complete <ID>`')
            .setColor('Red');
        m.author.send({ embeds: [apEmbed] }).catch(() => {});
    }

    if (m.content.startsWith('!order')) {
        const args = m.content.split(' ');
        const trxId = args[1]?.toUpperCase();
        if (!trxId) return m.channel.send("❌ Usage: `!order TRX-XXXXXX`").then(msg => setTimeout(() => msg.delete(), 5000));
        
        const order = db.prepare(`SELECT * FROM purchases WHERE order_id = ?`).get(trxId);
        if (!order) return m.channel.send("❌ Order not found.");

        const orderEmbed = new EmbedBuilder()
            .setTitle(`📦 Order Details: ${trxId}`)
            .addFields(
                { name: 'Buyer', value: `<@${order.user_id}> (\`${order.user_id}\`)`, inline: true },
                { name: 'Item', value: order.item, inline: true },
                { name: 'Status', value: `\`${order.status}\``, inline: true },
                { name: 'Time', value: order.time }
            )
            .setColor(order.status === 'COMPLETED' ? 'Green' : 'Yellow');
        m.channel.send({ embeds: [orderEmbed] });
    }

    if (m.content.startsWith('!complete')) {
        const args = m.content.split(' ');
        const trxId = args[1]?.toUpperCase();
        const res = db.prepare(`UPDATE purchases SET status = 'COMPLETED' WHERE order_id = ?`).run(trxId);
        if (res.changes > 0) m.channel.send(`✅ Order **${trxId}** marked as finished.`);
        else m.channel.send("❌ Order ID not found.");
    }

    if (m.content.startsWith('!log')) {
        await m.delete().catch(() => {});
        const channel = m.mentions.channels.first();
        if (channel) {
            db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('game_logs', ?)`).run(channel.id);
            const r = await m.channel.send(`✅ Game logs set to ${channel}`);
            setTimeout(() => r.delete(), 5000);
        }
    }

    if (m.content.startsWith('!addcoins')) {
        await m.delete().catch(() => {});
        const args = m.content.split(' ');
        const target = m.mentions.users.first();
        const amt = parseInt(args[2]);
        if (target && !isNaN(amt)) {
            db.prepare(`UPDATE users SET balance = balance + ? WHERE id = ?`).run(amt, target.id);
            const r = await m.channel.send(`✅ Added **${amt.toLocaleString()}** 🪙 to **${target.username}**`);
            setTimeout(() => r.delete(), 5000);
        }
    }

    if (m.content === '!purchaseall') {
        await m.delete().catch(() => {});
        const rows = db.prepare(`SELECT * FROM purchases ORDER BY id DESC LIMIT 15`).all();
        let list = rows.map(r => `\`${r.order_id || 'OLD'}\` <@${r.user_id}>: **${r.item}** (${r.status || 'PENDING'})`).join('\n') || "No history.";
        m.channel.send({ embeds: [new EmbedBuilder().setTitle('🛒 Shop History').setDescription(list).setColor('Blue')] });
    }

    if (m.content === '!cleardata') {
        await m.delete().catch(() => {});
        db.prepare(`DELETE FROM users`).run();
        db.prepare(`DELETE FROM purchases`).run();
        const r = await m.channel.send("☢️ **Database Cleared.**");
        setTimeout(() => r.delete(), 5000);
    }
});

/* ================= UTILS ================= */
const createDeck = () => {
    const suits = ['♠️', '♥️', '♦️', '♣️'], values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    let deck = []; for (let s of suits) for (let v of values) deck.push({ v, s });
    return deck.sort(() => Math.random() - 0.5);
};
const calcHand = (h) => {
    let s = 0, a = 0;
    for (let c of h) { if (c.v === 'A') { a++; s += 11; } else if (['J','Q','K'].includes(c.v)) s += 10; else s += parseInt(c.v); }
    while (s > 21 && a > 0) { s -= 10; a--; } return s;
};

/* ================= INTERACTION HANDLER ================= */
client.on('interactionCreate', async i => {
    if (!i.guild) return;
    const user = getUser(i.user.id);
    const multiplier = hasItem(user, 'multiplier') ? 1.5 : 1;

    if (i.commandName === 'daily') {
        const now = Date.now();
        if (now - user.lastDaily < 86400000) {
            const ready = Math.floor((user.lastDaily + 86400000) / 1000);
            return i.reply({ content: `⌛ Claim next: <t:${ready}:F> (<t:${ready}:R>)`, ephemeral: true });
        }
        let amt = Math.floor(500 * multiplier);
        db.prepare(`UPDATE users SET balance = balance + ?, lastDaily = ? WHERE id = ?`).run(amt, now, i.user.id);
        return i.reply(`🎁 **+${amt.toLocaleString()}** 🪙 added to your wallet!`);
    }

    if (i.commandName === 'work') {
        const now = Date.now();
        if (now - user.lastWork < 1800000) {
            return i.reply({ content: `👷 Work again in **${Math.floor((1800000 - (now - user.lastWork))/60000)}m**.`, ephemeral: true });
        }
        let pay = Math.floor((Math.random() * 250 + 100) * multiplier);
        db.prepare(`UPDATE users SET balance = balance + ?, lastWork = ? WHERE id = ?`).run(pay, now, i.user.id);
        return i.reply(`🔨 You earned **${pay}** 🪙!`);
    }

    if (i.commandName === 'leaderboard') {
        await i.deferReply();
        const top = db.prepare(`SELECT id, balance FROM users ORDER BY balance DESC LIMIT 10`).all();
        let list = "";
        for (let j = 0; j < top.length; j++) {
            const member = await i.guild.members.fetch(top[j].id).catch(() => null);
            list += `**${j + 1}.** ${member ? member.displayName : "Member Left"} — ${top[j].balance.toLocaleString()} 🪙\n`;
        }
        return i.editReply({ embeds: [new EmbedBuilder().setTitle('🏆 Wealth Leaderboard').setDescription(list || 'Empty').setColor('Gold')] });
    }

    if (i.commandName === 'gift') {
        const target = i.options.getUser('user');
        const amt = i.options.getInteger('amount');
        if (user.balance < amt) return i.reply("❌ Insufficient funds.");
        db.prepare(`UPDATE users SET balance = balance - ? WHERE id = ?`).run(amt, i.user.id);
        db.prepare(`UPDATE users SET balance = balance + ? WHERE id = ?`).run(amt, target.id);
        return i.reply(`🎁 Gifted **${amt.toLocaleString()}** 🪙 to ${target}!`);
    }

    if (i.commandName === 'shop') {
        const shopEmbed = new EmbedBuilder()
            .setTitle('🛒 Luxury Shop')
            .setDescription(`**Wallet:**\n${user.balance.toLocaleString()} 🪙\n\n` +
                `✨ **Luck Boost** (25k)\n*50% Luck Boost - 1 Hour*\n\n` +
                `📈 **Multiplier** (75k)\n*1.5x Multiplier*\n\n` +
                `🏷️ **Custom Role** (750k)\n\n` +
                `🔊 **Custom VC** (500k)\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            .setColor('#F1C40F');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('buy_luck').setLabel('Luck').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('buy_mult').setLabel('Multiplier').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('buy_role').setLabel('Role').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('buy_vc').setLabel('VC').setStyle(ButtonStyle.Primary)
        );
        return i.reply({ embeds: [shopEmbed], components: [row] });
    }

    if (i.isButton() && i.customId.startsWith('buy_')) {
        const itemType = i.customId.split('_')[1];
        const items = { 
            luck: { name: 'luck', price: 25000, label: 'Luck Boost' }, 
            mult: { name: 'multiplier', price: 75000, label: 'Multiplier' }, 
            role: { name: 'role', price: 750000, label: 'Custom Role' }, 
            vc: { name: 'vc', price: 500000, label: 'Custom VC' } 
        };
        const selected = items[itemType];
        if (user.balance < selected.price) return i.reply({ content: "❌ You cannot afford this.", ephemeral: true });

        const trxId = generateOrderID();
        let currentItems = JSON.parse(user.items || '[]');
        if (itemType === 'luck' || itemType === 'mult') currentItems.push({ name: selected.name, expires: Date.now() + 3600000 });
        
        db.prepare(`UPDATE users SET balance = balance - ?, items = ? WHERE id = ?`).run(selected.price, JSON.stringify(currentItems), i.user.id);
        db.prepare(`INSERT INTO purchases (user_id, item, time, order_id, status) VALUES (?, ?, ?, ?, 'PENDING')`)
            .run(i.user.id, selected.label, new Date().toLocaleString(), trxId);

        const receipt = new EmbedBuilder()
            .setTitle('🧾 Purchase Receipt')
            .addFields(
                { name: 'Item', value: selected.label, inline: true },
                { name: 'Cost', value: `${selected.price.toLocaleString()} 🪙`, inline: true },
                { name: 'User ID', value: `\`${i.user.id}\`` },
                { name: 'Order ID', value: `\`${trxId}\`` }
            )
            .setDescription('⚠️ For Roles/VCs, open a ticket and show this receipt!')
            .setColor('Green')
            .setTimestamp();

        await i.user.send({ embeds: [receipt] }).catch(() => {});
        return i.reply({ content: `✅ Purchased **${selected.label}**! Order ID: \`${trxId}\` sent to DMs.`, ephemeral: true });
    }

    if (i.commandName === 'coinflip') {
        const bet = i.options.getInteger('bet');
        if (bet > 10000) return i.reply({ content: "❌ Max bet is 10,000 🪙!", ephemeral: true });
        if (user.balance < bet) return i.reply("❌ Not enough coins.");
        const win = Math.random() < (hasItem(user, 'luck') ? 0.625 : 0.5);
        db.prepare(`UPDATE users SET balance = balance + ? WHERE id = ?`).run(win ? bet : -bet, i.user.id);
        gameLog(i.guild, i.user, 'Coinflip', bet, win ? '🟩 WIN' : '🟥 LOSS', win ? 'Green' : 'Red', `Side Choice: ${i.options.getString('side') === 'h' ? 'Heads' : 'Tails'}`);
        return i.reply({ embeds: [new EmbedBuilder().setTitle(win ? '🪙 Coinflip: Win!' : '🪙 Coinflip: Loss').setDescription(`You ${win ? 'won' : 'lost'} **${bet.toLocaleString()}** coins.`).setColor(win ? 'Green' : 'Red')] });
    }

    if (i.commandName === 'blackjack') {
        let bet = i.options.getInteger('bet');
        if (bet > 10000) return i.reply({ content: "❌ Max bet is 10,000 🪙!", ephemeral: true });
        if (user.balance < bet) return i.reply("❌ Not enough coins.");
        await i.deferReply(); 
        let deck = createDeck();
        let pHand = [deck.pop(), deck.pop()], dHand = [deck.pop(), deck.pop()];
        
        const getEmbed = (over = false, status = "Playing...") => {
            const pS = calcHand(pHand), dS = calcHand(dHand);
            return new EmbedBuilder()
                .setTitle('🃏 Blackjack Table')
                .setDescription(`**Status:** ${status}`)
                .addFields(
                    { name: `👤 Your Hand (${pS})`, value: pHand.map(c=>`\`${c.v}${c.s}\``).join(' '), inline: true },
                    { name: `🕵️ Dealer Hand (${over ? dS : '?'})`, value: over ? dHand.map(c=>`\`${c.v}${c.s}\``).join(' ') : `\`${dHand[0].v}${dHand[0].s}\` \`??\``, inline: true }
                )
                .setColor(over ? (pS > 21 || (dS <= 21 && dS > pS) ? 'Red' : (pS === dS ? 'Grey' : 'Green')) : 'Blue');
        };

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('bj_stand').setLabel('Stand').setStyle(ButtonStyle.Secondary)
        );

        const msg = await i.editReply({ embeds: [getEmbed()], components: [row] });
        const coll = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

        coll.on('collect', async bx => {
            if (bx.user.id !== i.user.id) return bx.reply({content: "Not your game!", ephemeral: true});
            if (bx.customId === 'bj_hit') {
                pHand.push(deck.pop());
                const currentScore = calcHand(pHand);
                if (currentScore > 21) {
                    db.prepare(`UPDATE users SET balance = balance - ? WHERE id = ?`).run(bet, i.user.id);
                    await bx.update({ embeds: [getEmbed(true, "💥 Busted!")], components: [] });
                    gameLog(i.guild, i.user, 'Blackjack', bet, '🟥 LOSS', 'Red', `Busted with ${currentScore}`);
                    coll.stop();
                } else await bx.update({ embeds: [getEmbed()] });
            } else if (bx.customId === 'bj_stand') {
                while (calcHand(dHand) < 17) dHand.push(deck.pop());
                const pS = calcHand(pHand), dS = calcHand(dHand);
                const win = dS > 21 || pS > dS, draw = pS === dS;
                
                if (win) {
                    db.prepare(`UPDATE users SET balance = balance + ? WHERE id = ?`).run(bet, i.user.id);
                    gameLog(i.guild, i.user, 'Blackjack', bet, '🟩 WIN', 'Green', `Player ${pS} vs Dealer ${dS}`);
                } else if (!draw) {
                    db.prepare(`UPDATE users SET balance = balance - ? WHERE id = ?`).run(bet, i.user.id);
                    gameLog(i.guild, i.user, 'Blackjack', bet, '🟥 LOSS', 'Red', `Player ${pS} vs Dealer ${dS}`);
                } else {
                    gameLog(i.guild, i.user, 'Blackjack', bet, '⬜ DRAW', 'Grey', `Both had ${pS}`);
                }
                
                await bx.update({ 
                    embeds: [getEmbed(true, win ? `✅ **You won ${bet.toLocaleString()}!**` : (draw ? '🤝 **Push (Draw)**' : `❌ **House wins.**`))], 
                    components: [] 
                });
                coll.stop();
            }
        });
    }

    if (i.commandName === 'wallet') return i.reply(`👛 **Wallet:** ${user.balance.toLocaleString()} 🪙`);
});

/* ================= DEPLOY ================= */
const commands = [
    new SlashCommandBuilder().setName('wallet').setDescription('👛 Check your coin balance'),
    new SlashCommandBuilder().setName('daily').setDescription('🎁 Claim your daily reward'),
    new SlashCommandBuilder().setName('work').setDescription('🔨 Work for coins (30m CD)'),
    new SlashCommandBuilder().setName('shop').setDescription('🛒 View and buy shop items'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('🏆 Richest players list'),
    new SlashCommandBuilder().setName('blackjack').setDescription('🃏 Play cards against dealer (Max 10k)').addIntegerOption(o=>o.setName('bet').setRequired(true).setDescription('Bet amount')),
    new SlashCommandBuilder().setName('coinflip').setDescription('🪙 Flip a coin (Max 10k)').addIntegerOption(o=>o.setName('bet').setRequired(true).setDescription('Bet amount')).addStringOption(o=>o.setName('side').setRequired(true).setDescription('Heads or Tails').addChoices({name:'Heads',value:'h'},{name:'Tails',value:'t'})),
    new SlashCommandBuilder().setName('gift').setDescription('🎁 Gift coins to a user').addUserOption(o=>o.setName('user').setRequired(true).setDescription('Recipient')).addIntegerOption(o=>o.setName('amount').setRequired(true).setDescription('Amount to gift'))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
    try {
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
        client.login(process.env.TOKEN);
        console.log("💎 BOT ONLINE - NEW ADMIN ADDED");
    } catch (e) { console.error(e); }
})();
