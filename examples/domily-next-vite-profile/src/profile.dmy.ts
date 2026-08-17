import { definePage } from '@domily/next';

/**
 * A second business page using the same optional preset as Todo, with no
 * project-specific renderer. Effects remain in profile-service.ts.
 */
export default definePage({
  schema: 'domily.page/v1',
  id: 'profile-settings',
  requires: {
    catalogs: ['@domily/native-html@^1', '@domily/next/business-form@^1'],
    capabilities: ['profile.save@^1'],
    extensions: ['@domily/next/business-form@^1'],
  },
  extensions: {
    '@domily/next/business-form': {
      drafts: {
        profileEditor: {
          initial: {
            displayName: 'Ada Lovelace',
            email: 'ada@example.com',
          },
        },
      },
    },
  },
  ui: {
    type: 'html.main',
    props: { className: 'profile-shell' },
    children: [
      {
        type: 'html.div',
        props: { className: 'profile-shell__header' },
        children: [
          { type: 'html.p', props: { className: 'eyebrow' }, children: [{ type: 'html.text', props: { value: 'PROFILE SETTINGS' } }] },
          { type: 'html.p', children: [{ type: 'html.text', props: { value: '第二个页面复用 business.form；没有引入新的状态机或工作流。' } }] },
        ],
      },
      {
        type: 'business.form',
        props: {
          className: 'profile-form',
          fields: [
            {
              className: 'profile-form__input',
              label: '显示名称',
              name: 'displayName',
              placeholder: '输入公开显示名称',
              required: true,
            },
            {
              className: 'profile-form__input',
              label: '邮箱地址',
              name: 'email',
              placeholder: 'name@example.com',
              required: true,
            },
          ],
          submitLabel: '保存资料',
        },
        bind: { value: '$businessForm.profileEditor' },
        on: {
          submit: {
            capability: 'profile.save',
            args: {
              displayName: '$businessForm.profileEditor.displayName',
              email: '$businessForm.profileEditor.email',
            },
          },
        },
      },
      {
        type: 'html.p',
        props: { className: 'profile-status' },
        children: [{ type: 'html.text', props: { value: '$profile.lastSaved' } }],
      },
    ],
  },
});
