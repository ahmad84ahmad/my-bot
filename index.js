require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
  Partials,
  MessageFlags
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

const SUPPORT_ROLE_ID = "1489761088282165248";
const ADMIN_ROLE_ID = "1489912807943045180";

let setupData = {
  cat: null,
  archive: null,
  room: null,
  panelimg: "",
  ticketimg: ""
};

const tickets = new Map();

let ticketTypes = [
  { label: "دعم", value: "support", description: "مشكلة أو استفسار" },
  { label: "شراء", value: "buy", description: "طلب شراء" }
];

function isAdmin(member) {
  return member.roles.cache.has(ADMIN_ROLE_ID);
}

function isSupport(member) {
  return member.roles.cache.has(SUPPORT_ROLE_ID) || member.roles.cache.has(ADMIN_ROLE_ID);
}

function sanitizeName(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF\- ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 90) || "ticket";
}

function buildPanelEmbed() {
  const embed = new EmbedBuilder()
    .setTitle("🎫 نظام التذاكر")
    .setDescription("اختر نوع التذكرة من القائمة");

  if (setupData.panelimg && setupData.panelimg.trim()) {
    embed.setImage(setupData.panelimg.trim());
  }

  return embed;
}

function buildTicketEmbed(typeLabel, msg) {
  const embed = new EmbedBuilder()
    .setTitle("🎫 تذكرة جديدة")
    .setDescription(
      `📌 النوع: ${typeLabel}\n\n📝 الطلب:\n${msg}\n\n━━━━━━━━━━━━━━━\n⏱️ ملاحظة:\nسيتم إغلاق التذكرة تلقائيًا بعد 24 ساعة`
    );

  if (setupData.ticketimg && setupData.ticketimg.trim()) {
    embed.setImage(setupData.ticketimg.trim());
  }

  return embed;
}

function buildMainButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("claim")
      .setLabel("📥 استلام")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("unclaim")
      .setLabel("↩️ إلغاء الاستلام")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("add")
      .setLabel("➕ إضافة عضو")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("edit")
      .setLabel("✏️ تعديل")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("close")
      .setLabel("🔒 إغلاق")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildDeleteRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("delete")
      .setLabel("🗑️ حذف")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildRatingRow(channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rate_1_${channelId}`).setLabel("⭐").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rate_2_${channelId}`).setLabel("⭐⭐").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rate_3_${channelId}`).setLabel("⭐⭐⭐").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rate_4_${channelId}`).setLabel("⭐⭐⭐⭐").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rate_5_${channelId}`).setLabel("⭐⭐⭐⭐⭐").setStyle(ButtonStyle.Success)
  );
}

function hasOpenTicket(userId) {
  for (const data of tickets.values()) {
    if (data.user === userId && !data.closed) return true;
  }
  return false;
}

async function autoCloseTicket(channel) {
  const data = tickets.get(channel.id);
  if (!data || data.closed) return;

  data.closed = true;

  const owner = await client.users.fetch(data.user).catch(() => null);
  if (owner) {
    await owner.send({
      content: "📩 تم إغلاق التذكرة تلقائيًا بعد 24 ساعة\n⭐ قيّم الخدمة:",
      components: [buildRatingRow(channel.id)]
    }).catch(() => {});
  }

  await channel.send("⏱️ تم إغلاق التذكرة تلقائيًا بعد 24 ساعة").catch(() => {});
  await channel.setParent(setupData.archive).catch(() => {});
  if (!channel.name.startsWith("closed-")) {
    await channel.setName(`closed-${channel.name}`.slice(0, 90)).catch(() => {});
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("setup ticket system"),

  new SlashCommandBuilder()
    .setName("ticket-add")
    .setDescription("add ticket type")
    .addStringOption(o =>
      o.setName("name").setDescription("type name").setRequired(true))
    .addStringOption(o =>
      o.setName("desc").setDescription("type description").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ticket-edit")
    .setDescription("edit ticket type")
    .addStringOption(o =>
      o.setName("old").setDescription("old type name").setRequired(true))
    .addStringOption(o =>
      o.setName("new").setDescription("new type name").setRequired(true))
    .addStringOption(o =>
      o.setName("desc").setDescription("new description").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ticket-remove")
    .setDescription("remove ticket type")
    .addStringOption(o =>
      o.setName("name").setDescription("type name").setRequired(true))
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("✅ Commands Registered");
  } catch (err) {
    console.error("Register error:", err);
  }
})();

client.once("clientReady", () => {
  console.log(`🔥 ${client.user.tag}`);
});

client.on("interactionCreate", async (i) => {
  try {
    // slash commands
    if (i.isChatInputCommand()) {
      if (i.commandName === "ticket-add") {
        if (!isAdmin(i.member)) {
          return i.reply({ content: "❌ فقط الإدارة", flags: MessageFlags.Ephemeral });
        }

        const name = i.options.getString("name");
        const desc = i.options.getString("desc");

        ticketTypes.push({
          label: name,
          value: sanitizeName(name),
          description: desc
        });

        return i.reply({ content: "✅ تم إضافة النوع", flags: MessageFlags.Ephemeral });
      }

      if (i.commandName === "ticket-edit") {
        if (!isAdmin(i.member)) {
          return i.reply({ content: "❌ فقط الإدارة", flags: MessageFlags.Ephemeral });
        }

        const oldName = i.options.getString("old");
        const newName = i.options.getString("new");
        const desc = i.options.getString("desc");

        const t = ticketTypes.find(x => x.label === oldName);
        if (!t) {
          return i.reply({ content: "❌ النوع غير موجود", flags: MessageFlags.Ephemeral });
        }

        t.label = newName;
        t.value = sanitizeName(newName);
        t.description = desc;

        return i.reply({ content: "✅ تم تعديل النوع", flags: MessageFlags.Ephemeral });
      }

      if (i.commandName === "ticket-remove") {
        if (!isAdmin(i.member)) {
          return i.reply({ content: "❌ فقط الإدارة", flags: MessageFlags.Ephemeral });
        }

        const name = i.options.getString("name");
        const before = ticketTypes.length;
        ticketTypes = ticketTypes.filter(x => x.label !== name);

        if (ticketTypes.length === before) {
          return i.reply({ content: "❌ النوع غير موجود", flags: MessageFlags.Ephemeral });
        }

        return i.reply({ content: "✅ تم حذف النوع", flags: MessageFlags.Ephemeral });
      }

      if (i.commandName === "setup") {
        const modal = new ModalBuilder()
          .setCustomId("setup_modal")
          .setTitle("setup ticket");

        const cat = new TextInputBuilder()
          .setCustomId("cat")
          .setLabel("ticket category id")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const archive = new TextInputBuilder()
          .setCustomId("archive")
          .setLabel("archive category id")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const room = new TextInputBuilder()
          .setCustomId("room")
          .setLabel("panel room id")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const panelimg = new TextInputBuilder()
          .setCustomId("panelimg")
          .setLabel("panel image url")
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const ticketimg = new TextInputBuilder()
          .setCustomId("ticketimg")
          .setLabel("ticket image url")
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(cat),
          new ActionRowBuilder().addComponents(archive),
          new ActionRowBuilder().addComponents(room),
          new ActionRowBuilder().addComponents(panelimg),
          new ActionRowBuilder().addComponents(ticketimg)
        );

        return i.showModal(modal);
      }
    }

    // setup modal
    if (i.isModalSubmit() && i.customId === "setup_modal") {
      setupData = {
        cat: i.fields.getTextInputValue("cat"),
        archive: i.fields.getTextInputValue("archive"),
        room: i.fields.getTextInputValue("room"),
        panelimg: i.fields.getTextInputValue("panelimg") || "",
        ticketimg: i.fields.getTextInputValue("ticketimg") || ""
      };

      const panelChannel = i.guild.channels.cache.get(setupData.room);
      if (!panelChannel) {
        return i.reply({ content: "❌ روم البانل غير صحيح", flags: MessageFlags.Ephemeral });
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId("ticket_select")
        .setPlaceholder("اختر نوع التذكرة")
        .addOptions(ticketTypes);

      await panelChannel.send({
        embeds: [buildPanelEmbed()],
        components: [new ActionRowBuilder().addComponents(menu)]
      });

      return i.reply({ content: "✅ تم الإعداد وإرسال البانل", flags: MessageFlags.Ephemeral });
    }

    // select menu
    if (i.isStringSelectMenu() && i.customId === "ticket_select") {
      if (hasOpenTicket(i.user.id)) {
        return i.reply({ content: "❌ عندك تذكرة مفتوحة بالفعل", flags: MessageFlags.Ephemeral });
      }

      const typeValue = i.values[0];
      const selected = ticketTypes.find(t => t.value === typeValue);

      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal_${typeValue}`)
        .setTitle(selected ? selected.label : "تذكرة");

      const input = new TextInputBuilder()
        .setCustomId("msg")
        .setLabel("اكتب طلبك")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return i.showModal(modal);
    }

    // create ticket
    if (i.isModalSubmit() && i.customId.startsWith("ticket_modal_")) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        if (!setupData.cat || !setupData.archive || !setupData.room) {
          return i.editReply("❌ لازم تسوي setup أول");
        }

        if (hasOpenTicket(i.user.id)) {
          return i.editReply("❌ عندك تذكرة مفتوحة بالفعل");
        }

        const typeValue = i.customId.replace("ticket_modal_", "");
        const selected = ticketTypes.find(t => t.value === typeValue);
        const msg = i.fields.getTextInputValue("msg");

        const ch = await i.guild.channels.create({
          name: sanitizeName(`ticket-${typeValue}-${i.user.username}`),
          parent: setupData.cat,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            {
              id: i.guild.id,
              deny: [PermissionsBitField.Flags.ViewChannel]
            },
            {
              id: i.user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
              ]
            },
            {
              id: SUPPORT_ROLE_ID,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
              ]
            },
            {
              id: ADMIN_ROLE_ID,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.ManageChannels
              ]
            }
          ]
        });

        tickets.set(ch.id, {
          user: i.user.id,
          claimed: null,
          name: ch.name,
          closed: false,
          type: selected ? selected.label : typeValue
        });

        await ch.send({
          content: `<@${i.user.id}> <@&${SUPPORT_ROLE_ID}>`,
          embeds: [buildTicketEmbed(selected ? selected.label : typeValue, msg)],
          components: [buildMainButtons(), buildDeleteRow()]
        });

        setTimeout(async () => {
          await autoCloseTicket(ch).catch(() => {});
        }, 24 * 60 * 60 * 1000);

        return i.editReply(`✅ تم فتح التذكرة: ${ch}`);
      } catch (err) {
        console.error("Create ticket error:", err);
        return i.editReply("❌ صار خطأ أثناء فتح التذكرة");
      }
    }

    // claim
    if (i.isButton() && i.customId === "claim") {
      if (!isSupport(i.member)) {
        return i.reply({ content: "❌ فقط الدعم أو الإدارة", flags: MessageFlags.Ephemeral });
      }

      const data = tickets.get(i.channel.id);
      if (!data) {
        return i.reply({ content: "❌ هذه ليست تذكرة", flags: MessageFlags.Ephemeral });
      }

      if (data.claimed) {
        return i.reply({ content: "❌ التذكرة مستلمة بالفعل", flags: MessageFlags.Ephemeral });
      }

      data.claimed = i.user.id;
      await i.channel.setName(sanitizeName(`claimed-${i.user.username}`));

      return i.reply({ content: `📥 تم استلام التذكرة بواسطة ${i.user}` });
    }

    // unclaim
    if (i.isButton() && i.customId === "unclaim") {
      const data = tickets.get(i.channel.id);
      if (!data) {
        return i.reply({ content: "❌ هذه ليست تذكرة", flags: MessageFlags.Ephemeral });
      }

      if (data.claimed !== i.user.id && !isAdmin(i.member)) {
        return i.reply({ content: "❌ فقط المستلم أو الإدارة", flags: MessageFlags.Ephemeral });
      }

      data.claimed = null;
      await i.channel.setName(data.name);

      return i.reply({ content: "↩️ تم إلغاء الاستلام" });
    }

    // add member
    if (i.isButton() && i.customId === "add") {
      if (!isSupport(i.member)) {
        return i.reply({ content: "❌ فقط الدعم أو الإدارة", flags: MessageFlags.Ephemeral });
      }

      const menu = new UserSelectMenuBuilder()
        .setCustomId("adduser")
        .setPlaceholder("اختر عضوًا")
        .setMinValues(1)
        .setMaxValues(1);

      return i.reply({
        content: "اختر عضوًا لإضافته للتذكرة",
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: MessageFlags.Ephemeral
      });
    }

    if (i.isUserSelectMenu() && i.customId === "adduser") {
      await i.channel.permissionOverwrites.edit(i.values[0], {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });

      return i.reply({ content: "✅ تمت إضافة العضو", flags: MessageFlags.Ephemeral });
    }

    // edit
    if (i.isButton() && i.customId === "edit") {
      if (!isAdmin(i.member)) {
        return i.reply({ content: "❌ فقط الإدارة", flags: MessageFlags.Ephemeral });
      }

      const modal = new ModalBuilder()
        .setCustomId("edit_modal")
        .setTitle("تعديل اسم التذكرة");

      const input = new TextInputBuilder()
        .setCustomId("name")
        .setLabel("الاسم الجديد")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === "edit_modal") {
      if (!isAdmin(i.member)) {
        return i.reply({ content: "❌ فقط الإدارة", flags: MessageFlags.Ephemeral });
      }

      const data = tickets.get(i.channel.id);
      if (!data) {
        return i.reply({ content: "❌ هذه ليست تذكرة", flags: MessageFlags.Ephemeral });
      }

      const newName = sanitizeName(i.fields.getTextInputValue("name"));
      data.name = newName;
      await i.channel.setName(newName);

      return i.reply({ content: "✅ تم تعديل الاسم", flags: MessageFlags.Ephemeral });
    }

    // close
    if (i.isButton() && i.customId === "close") {
      if (!isAdmin(i.member)) {
        return i.reply({ content: "❌ فقط الإدارة", flags: MessageFlags.Ephemeral });
      }

      const data = tickets.get(i.channel.id);
      if (!data) {
        return i.reply({ content: "❌ هذه ليست تذكرة", flags: MessageFlags.Ephemeral });
      }

      await i.reply({ content: "🔒 جاري الإغلاق...", flags: MessageFlags.Ephemeral });

      data.closed = true;

      const owner = await client.users.fetch(data.user).catch(() => null);
      if (owner) {
        await owner.send({
          content: `📩 تم إغلاق التذكرة بواسطة ${i.user}\n⭐ قيّم الخدمة:`,
          components: [buildRatingRow(i.channel.id)]
        }).catch(() => {});
      }

      await i.channel.setParent(setupData.archive).catch(() => {});
      if (!i.channel.name.startsWith("closed-")) {
        await i.channel.setName(`closed-${i.channel.name}`.slice(0, 90)).catch(() => {});
      }
      await i.channel.send(`🔒 تم إغلاق التذكرة بواسطة ${i.user}`).catch(() => {});
    }

    // rate
    if (i.isButton() && i.customId.startsWith("rate_")) {

  const [_, stars, channelId] = i.customId.split("_");
  const data = tickets.get(channelId);

  if (!data)
    return i.reply({ content: "❌ التذكرة غير موجودة", flags: 64 });

  if (!data.claimed)
    return i.reply({ content: "❌ لم يتم استلام التذكرة", flags: 64 });

  const staff = await client.users.fetch(data.claimed).catch(()=>null);

  if (staff) {
    await staff.send(`
⭐ تم تقييمك!

👤 العميل: <@${data.user}>
⭐ التقييم: ${stars} / 5
🎫 التذكرة: ${channelId}
`).catch(()=>{});
  }

  return i.reply({
    content: `✅ تم إرسال تقييمك (${stars} ⭐)`,
    flags: 64
  });
}

    // delete
    if (i.isButton() && i.customId === "delete") {
      if (!isAdmin(i.member)) {
        return i.reply({ content: "❌ فقط الإدارة", flags: MessageFlags.Ephemeral });
      }

      await i.reply({ content: "🗑️ جاري الحذف..." });

      setTimeout(() => {
        i.channel.delete().catch(() => {});
      }, 1500);
    }
  } catch (e) {
    console.error(e);
    if (i.isRepliable() && !i.replied && !i.deferred) {
      await i.reply({ content: "❌ صار خطأ", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.login(process.env.TOKEN);
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.listen(3000, () => {
  console.log('Web server is running');
});
