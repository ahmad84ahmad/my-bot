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

const mongoose = require("mongoose");
const express = require("express");

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

const DEFAULT_TICKET_TYPES = [
  { label: "دعم", value: "support", description: "مشكلة أو استفسار" },
  { label: "شراء", value: "buy", description: "طلب شراء" }
];

const setupSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  cat: { type: String, default: null },
  archive: { type: String, default: null },
  room: { type: String, default: null },
  panelimg: { type: String, default: "" },
  ticketimg: { type: String, default: "" },
  ticketTypes: {
    type: [
      {
        label: { type: String, required: true },
        value: { type: String, required: true },
        description: { type: String, required: true }
      }
    ],
    default: DEFAULT_TICKET_TYPES
  }
}, { timestamps: true });

const ticketSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  channelId: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  claimedBy: { type: String, default: null },
  name: { type: String, required: true },
  closed: { type: Boolean, default: false },
  type: { type: String, required: true }
}, { timestamps: true });

const Setup = mongoose.model("Setup", setupSchema);
const Ticket = mongoose.model("Ticket", ticketSchema);

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

function isValidHttpUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function buildPanelEmbed(setup) {
  const embed = new EmbedBuilder()
    .setTitle("🎫 نظام التذاكر")
    .setDescription("اختر نوع التذكرة من القائمة");

  if (isValidHttpUrl(setup?.panelimg)) {
    embed.setImage(setup.panelimg.trim());
  }

  return embed;
}

function buildTicketEmbed(typeLabel, msg, setup) {
  const embed = new EmbedBuilder()
    .setTitle("🎫 تذكرة جديدة")
    .setDescription(
      `📌 النوع: ${typeLabel}\n\n📝 الطلب:\n${msg}\n\n━━━━━━━━━━━━━━━\n⏱️ ملاحظة:\nسيتم إغلاق التذكرة تلقائيًا بعد 24 ساعة`
    );

  if (isValidHttpUrl(setup?.ticketimg)) {
    embed.setImage(setup.ticketimg.trim());
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

async function getOrCreateSetup(guildId) {
  let setup = await Setup.findOne({ guildId });
  if (!setup) {
    setup = await Setup.create({
      guildId,
      ticketTypes: DEFAULT_TICKET_TYPES
    });
  }
  return setup;
}

async function hasOpenTicket(guildId, userId) {
  const ticket = await Ticket.findOne({
    guildId,
    userId,
    closed: false
  });
  return !!ticket;
}

async function autoCloseTicket(channel) {
  const data = await Ticket.findOne({ channelId: channel.id });
  if (!data || data.closed) return;

  const setup = await Setup.findOne({ guildId: data.guildId });
  if (!setup) return;

  data.closed = true;
  await data.save();

  const owner = await client.users.fetch(data.userId).catch(() => null);
  if (owner) {
    await owner.send({
      content: "📩 تم إغلاق التذكرة تلقائيًا بعد 24 ساعة\n⭐ قيّم الخدمة:",
      components: [buildRatingRow(channel.id)]
    }).catch(() => {});
  }

  await channel.send("⏱️ تم إغلاق التذكرة تلقائيًا بعد 24 ساعة").catch(() => {});
  if (setup.archive) {
    await channel.setParent(setup.archive).catch(() => {});
  }
  if (!channel.name.startsWith("closed-")) {
    await channel.setName(`closed-${channel.name}`.slice(0, 90)).catch(() => {});
  }
}

async function scheduleExistingOpenTickets() {
  const openTickets = await Ticket.find({ closed: false });
  const now = Date.now();

  for (const ticket of openTickets) {
    const createdAt = new Date(ticket.createdAt).getTime();
    const dueIn = Math.max(0, (24 * 60 * 60 * 1000) - (now - createdAt));

    setTimeout(async () => {
      const guild = client.guilds.cache.get(ticket.guildId);
      if (!guild) return;

      const channel = guild.channels.cache.get(ticket.channelId);
      if (!channel) return;

      await autoCloseTicket(channel).catch(() => {});
    }, dueIn);
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

async function registerCommands() {
  try {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("✅ Global Commands Registered");
  } catch (err) {
    console.error("Register error:", err);
  }
}

client.once("clientReady", async () => {
  console.log(`🔥 ${client.user.tag}`);
  await scheduleExistingOpenTickets();
});

client.on("interactionCreate", async (i) => {
  try {
    if (i.isChatInputCommand()) {
      if (i.commandName === "ticket-add") {
        if (!isAdmin(i.member)) {
          return i.reply({ content: "❌ فقط الإدارة", flags: MessageFlags.Ephemeral });
        }

        const setup = await getOrCreateSetup(i.guild.id);
        const name = i.options.getString("name");
        const desc = i.options.getString("desc");

        const value = sanitizeName(name);

        if (setup.ticketTypes.some(t => t.label === name || t.value === value)) {
          return i.reply({ content: "❌ النوع موجود بالفعل", flags: MessageFlags.Ephemeral });
        }

        setup.ticketTypes.push({
          label: name,
          value,
          description: desc
        });

        await setup.save();
        return i.reply({ content: "✅ تم إضافة النوع", flags: MessageFlags.Ephemeral });
      }

      if (i.commandName === "ticket-edit") {
        if (!isAdmin(i.member)) {
          return i.reply({ content: "❌ فقط الإدارة", flags: MessageFlags.Ephemeral });
        }

        const setup = await getOrCreateSetup(i.guild.id);
        const oldName = i.options.getString("old");
        const newName = i.options.getString("new");
        const desc = i.options.getString("desc");

        const t = setup.ticketTypes.find(x => x.label === oldName);
        if (!t) {
          return i.reply({ content: "❌ النوع غير موجود", flags: MessageFlags.Ephemeral });
        }

        t.label = newName;
        t.value = sanitizeName(newName);
        t.description = desc;

        await setup.save();
        return i.reply({ content: "✅ تم تعديل النوع", flags: MessageFlags.Ephemeral });
      }

      if (i.commandName === "ticket-remove") {
        if (!isAdmin(i.member)) {
          return i.reply({ content: "❌ فقط الإدارة", flags: MessageFlags.Ephemeral });
        }

        const setup = await getOrCreateSetup(i.guild.id);
        const name = i.options.getString("name");
        const before = setup.ticketTypes.length;

        setup.ticketTypes = setup.ticketTypes.filter(x => x.label !== name);
        if (setup.ticketTypes.length === before) {
          return i.reply({ content: "❌ النوع غير موجود", flags: MessageFlags.Ephemeral });
        }

        await setup.save();
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

    if (i.isModalSubmit() && i.customId === "setup_modal") {
      await i.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const setup = await getOrCreateSetup(i.guild.id);

        setup.cat = i.fields.getTextInputValue("cat").trim();
        setup.archive = i.fields.getTextInputValue("archive").trim();
        setup.room = i.fields.getTextInputValue("room").trim();
        setup.panelimg = (i.fields.getTextInputValue("panelimg") || "").trim();
        setup.ticketimg = (i.fields.getTextInputValue("ticketimg") || "").trim();

        await setup.save();

        const ticketCategory = i.guild.channels.cache.get(setup.cat);
        const archiveCategory = i.guild.channels.cache.get(setup.archive);
        const panelChannel = i.guild.channels.cache.get(setup.room);

        if (!ticketCategory || ticketCategory.type !== ChannelType.GuildCategory) {
          return i.editReply("❌ ايدي كاتيجوري التذاكر غير صحيح");
        }

        if (!archiveCategory || archiveCategory.type !== ChannelType.GuildCategory) {
          return i.editReply("❌ ايدي كاتيجوري الأرشيف غير صحيح");
        }

        if (!panelChannel) {
          return i.editReply("❌ روم البانل غير صحيح");
        }

        if (!panelChannel.isTextBased()) {
          return i.editReply("❌ لازم روم البانل يكون كتابي");
        }

        const perms = panelChannel.permissionsFor(i.guild.members.me);
        if (!perms || !perms.has([
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages
        ])) {
          return i.editReply("❌ البوت ما عنده صلاحيات كافية في روم البانل");
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId("ticket_select")
          .setPlaceholder("اختر نوع التذكرة")
        const validTypes = (setup.ticketTypes || [])
  .filter(t =>
    t &&
    typeof t === "object" &&
    typeof t.label === "string" &&
    t.label.trim() !== "" &&
    typeof t.value === "string" &&
    t.value.trim() !== ""
  )
  .map(t => ({
    label: t.label.trim(),
    value: t.value.trim(),
    description: t.description?.toString().slice(0, 100) || "—"
  }));

if (validTypes.length === 0) {
  return i.editReply("❌ ما فيه أنواع تذاكر صالحة (الداتا خربانة)");
}

   const menu = new StringSelectMenuBuilder()
   .setCustomId("ticket_select")
     .setPlaceholder("اختر نوع التذكرة")
        .addOptions(validTypes);

        try {
          await panelChannel.send({
            content: "🎫 نظام التذاكر",
            embeds: [buildPanelEmbed(setup)],
            components: [new ActionRowBuilder().addComponents(menu)]
          });
        } catch (err) {
          console.error("EMBED ERROR:", err);

          await panelChannel.send({
            content: "🎫 نظام التذاكر",
            components: [new ActionRowBuilder().addComponents(menu)]
          });
        }

        return i.editReply("✅ تم الإعداد وإرسال البانل");
      } catch (err) {
        console.error("SETUP ERROR:", err);
        return i.editReply("❌ خطأ في setup");
      }
    }

    if (i.isStringSelectMenu() && i.customId === "ticket_select") {
      if (await hasOpenTicket(i.guild.id, i.user.id)) {
        return i.reply({ content: "❌ عندك تذكرة مفتوحة بالفعل", flags: MessageFlags.Ephemeral });
      }

      const setup = await getOrCreateSetup(i.guild.id);
      const typeValue = i.values[0];
      const selected = setup.ticketTypes.find(t => t.value === typeValue);

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

    if (i.isModalSubmit() && i.customId.startsWith("ticket_modal_")) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const setup = await Setup.findOne({ guildId: i.guild.id });

        if (!setup || !setup.cat || !setup.archive || !setup.room) {
          return i.editReply("❌ لازم تسوي setup أول");
        }

        if (await hasOpenTicket(i.guild.id, i.user.id)) {
          return i.editReply("❌ عندك تذكرة مفتوحة بالفعل");
        }

        const typeValue = i.customId.replace("ticket_modal_", "");
        const selected = setup.ticketTypes.find(t => t.value === typeValue);
        const msg = i.fields.getTextInputValue("msg");

        const ch = await i.guild.channels.create({
          name: sanitizeName(`ticket-${typeValue}-${i.user.username}`),
          parent: setup.cat,
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

        await Ticket.create({
          guildId: i.guild.id,
          channelId: ch.id,
          userId: i.user.id,
          claimedBy: null,
          name: ch.name,
          closed: false,
          type: selected ? selected.label : typeValue
        });

        await ch.send({
          content: `<@${i.user.id}> <@&${SUPPORT_ROLE_ID}>`,
          embeds: [buildTicketEmbed(selected ? selected.label : typeValue, msg, setup)],
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

    if (i.isButton() && i.customId === "claim") {
      if (!isSupport(i.member)) {
        return i.reply({ content: "❌ فقط الدعم أو الإدارة", flags: MessageFlags.Ephemeral });
      }

      const data = await Ticket.findOne({ channelId: i.channel.id });
      if (!data) {
        return i.reply({ content: "❌ هذه ليست تذكرة", flags: MessageFlags.Ephemeral });
      }

      if (data.claimedBy) {
        return i.reply({ content: "❌ التذكرة مستلمة بالفعل", flags: MessageFlags.Ephemeral });
      }

      data.claimedBy = i.user.id;
      await data.save();

      await i.channel.setName(sanitizeName(`claimed-${i.user.username}`));
      return i.reply({ content: `📥 تم استلام التذكرة بواسطة ${i.user}` });
    }

    if (i.isButton() && i.customId === "unclaim") {
      const data = await Ticket.findOne({ channelId: i.channel.id });
      if (!data) {
        return i.reply({ content: "❌ هذه ليست تذكرة", flags: MessageFlags.Ephemeral });
      }

      if (data.claimedBy !== i.user.id && !isAdmin(i.member)) {
        return i.reply({ content: "❌ فقط المستلم أو الإدارة", flags: MessageFlags.Ephemeral });
      }

      data.claimedBy = null;
      await data.save();

      await i.channel.setName(data.name);
      return i.reply({ content: "↩️ تم إلغاء الاستلام" });
    }

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

      const data = await Ticket.findOne({ channelId: i.channel.id });
      if (!data) {
        return i.reply({ content: "❌ هذه ليست تذكرة", flags: MessageFlags.Ephemeral });
      }

      const newName = sanitizeName(i.fields.getTextInputValue("name"));
      data.name = newName;
      await data.save();

      await i.channel.setName(newName);
      return i.reply({ content: "✅ تم تعديل الاسم", flags: MessageFlags.Ephemeral });
    }

    if (i.isButton() && i.customId === "close") {
      if (!isAdmin(i.member)) {
        return i.reply({ content: "❌ فقط الإدارة", flags: MessageFlags.Ephemeral });
      }

      const data = await Ticket.findOne({ channelId: i.channel.id });
      if (!data) {
        return i.reply({ content: "❌ هذه ليست تذكرة", flags: MessageFlags.Ephemeral });
      }

      const setup = await Setup.findOne({ guildId: i.guild.id });
      if (!setup) {
        return i.reply({ content: "❌ لازم تسوي setup أول", flags: MessageFlags.Ephemeral });
      }

      await i.reply({ content: "🔒 جاري الإغلاق...", flags: MessageFlags.Ephemeral });

      data.closed = true;
      await data.save();

      const owner = await client.users.fetch(data.userId).catch(() => null);
      if (owner) {
        await owner.send({
          content: `📩 تم إغلاق التذكرة بواسطة ${i.user}\n⭐ قيّم الخدمة:`,
          components: [buildRatingRow(i.channel.id)]
        }).catch(() => {});
      }

      await i.channel.setParent(setup.archive).catch(() => {});
      if (!i.channel.name.startsWith("closed-")) {
        await i.channel.setName(`closed-${i.channel.name}`.slice(0, 90)).catch(() => {});
      }
      await i.channel.send(`🔒 تم إغلاق التذكرة بواسطة ${i.user}`).catch(() => {});
    }

    if (i.isButton() && i.customId.startsWith("rate_")) {
      const [_, stars, channelId] = i.customId.split("_");
      const data = await Ticket.findOne({ channelId });

      if (!data) {
        return i.reply({ content: "❌ التذكرة غير موجودة", flags: MessageFlags.Ephemeral });
      }

      if (!data.claimedBy) {
        return i.reply({ content: "❌ لم يتم استلام التذكرة", flags: MessageFlags.Ephemeral });
      }

      const staff = await client.users.fetch(data.claimedBy).catch(() => null);

      if (staff) {
        await staff.send(`
⭐ تم تقييمك!

👤 العميل: <@${data.userId}>
⭐ التقييم: ${stars} / 5
🎫 التذكرة: ${channelId}
`).catch(() => {});
      }

      return i.reply({
        content: `✅ تم إرسال تقييمك (${stars} ⭐)`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (i.isButton() && i.customId === "delete") {
      if (!isAdmin(i.member)) {
        return i.reply({ content: "❌ فقط الإدارة", flags: MessageFlags.Ephemeral });
      }

      await i.reply({ content: "🗑️ جاري الحذف..." });

      await Ticket.deleteOne({ channelId: i.channel.id }).catch(() => {});

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

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB Connected");

    await registerCommands();
    await client.login(process.env.TOKEN);
  } catch (err) {
    console.error("Startup error:", err);
  }
})();

const app = express();

app.get("/", (req, res) => {
  res.send("Bot is running");
});

app.listen(3000, () => {
  console.log("Web server is running");
});
