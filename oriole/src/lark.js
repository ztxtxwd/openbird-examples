import * as lark from '@larksuiteoapi/node-sdk';

export function createLarkClient({ appId, appSecret }, { client = new lark.Client({ appId, appSecret }) } = {}) {

  return {
    async listMessages(chatId, { pageSize = 50, startTime } = {}) {
      const params = {
        container_id_type: 'chat',
        container_id: chatId,
        sort_type: 'ByCreateTimeDesc',
        page_size: pageSize,
      };

      if (startTime != null) {
        params.start_time = startTime;
      }

      const iterator = await client.im.v1.message.listWithIterator({ params });
      const messages = [];

      for await (const page of iterator) {
        if (page == null) {
          throw new Error('Lark listMessages failed during pagination');
        }

        if (Array.isArray(page.items)) {
          messages.push(...page.items);
        }
      }

      return messages;
    },

    async sendMessage(chatId, text) {
      const res = await client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });

      if (res.code !== 0) {
        throw new Error(`Lark sendMessage failed: ${res.code} ${res.msg}`);
      }

      return res.data;
    },

    async replyMessage(messageId, text) {
      const res = await client.im.v1.message.reply({
        path: { message_id: messageId },
        data: {
          msg_type: 'text',
          content: JSON.stringify({ text }),
          reply_in_thread: true,
        },
      });

      if (res.code !== 0) {
        throw new Error(`Lark replyMessage failed: ${res.code} ${res.msg}`);
      }

      return res.data;
    },

    async editMessage(messageId, text) {
      const res = await client.im.v1.message.update({
        path: { message_id: messageId },
        data: {
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });

      if (res.code !== 0) {
        throw new Error(`Lark editMessage failed: ${res.code} ${res.msg}`);
      }

      return res.data;
    },
  };
}
