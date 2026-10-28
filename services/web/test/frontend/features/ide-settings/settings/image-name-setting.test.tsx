import { screen, within, render } from '@testing-library/react'
import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import type { ImageName } from '../../../../../types/project-settings'
import { SettingsModalProvider } from '@/features/ide-settings/context/settings-modal-context'
import {
  EditorProviders,
  projectDefaults,
} from '../../../helpers/editor-providers'
import ImageNameSetting from '@/features/ide-settings/components/compiler-settings/image-name-setting'
import userEvent from '@testing-library/user-event'

describe('<ImageNameSetting />', function () {
  const imageNames: ImageName[] = [
    {
      imageDesc: 'Image 1',
      imageName: 'img-1',
      allowed: true,
    },
    {
      imageDesc: 'Image 2',
      imageName: 'img-2',
      allowed: true,
    },
  ]

  beforeEach(function () {
    window.metaAttributesCache.set('ol-imageNames', imageNames)
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('each option is shown and can be selected', async function () {
    render(
      <EditorProviders>
        <SettingsModalProvider>
          <ImageNameSetting />
        </SettingsModalProvider>
      </EditorProviders>
    )

    const saveSettingsMock = fetchMock.post(
      `express:/project/:projectId/settings`,
      {
        status: 200,
      },
      { delay: 0 }
    )

    const select = screen.getByLabelText('TeX Live version')

    for (const { imageName, imageDesc } of imageNames) {
      const option = within(select).getByText(imageDesc)
      expect(option.getAttribute('value')).to.equal(imageName)
      await userEvent.selectOptions(select, [option])

      expect(
        saveSettingsMock.callHistory.called(
          `/project/${projectDefaults._id}/settings`,
          {
            body: { imageName },
          }
        )
      ).to.be.true
    }
  })

  it('keeps a retired image visible until an available replacement is selected', async function () {
    const currentImage = 'texlive-full:2026.1'
    render(
      <EditorProviders imageName={currentImage}>
        <SettingsModalProvider>
          <ImageNameSetting />
        </SettingsModalProvider>
      </EditorProviders>
    )

    const select = screen.getByLabelText('TeX Live version') as HTMLSelectElement
    const retired = within(select).getByRole('option', {
      name: 'TeX Live 2026',
    }) as HTMLOptionElement
    expect(select.value).to.equal(currentImage)
    expect(retired.disabled).to.be.true

    const saveSettingsMock = fetchMock.post('express:/project/:projectId/settings', {
      status: 200,
    })
    await userEvent.selectOptions(select, imageNames[0].imageName)

    expect(
      saveSettingsMock.callHistory.called(
        `/project/${projectDefaults._id}/settings`,
        { body: { imageName: imageNames[0].imageName } }
      )
    ).to.be.true
    expect(select.value).to.equal(imageNames[0].imageName)
  })
})
