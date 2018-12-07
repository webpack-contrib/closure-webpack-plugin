import { PolymerElement, html } from '@polymer/polymer/polymer-element';

class HelloWorldElement extends PolymerElement {
  static get is() {
    return 'hello-world';
  }

  static get template() {
    return html`
      <style>
        :host {
          display: block;
          background-color: #c0c0c0;
        }
      </style>
      <div>[[greeting]]</div>
    `;
  }

  static get properties() {
    return {
      greeting: {
        type: String,
        value: 'hello world'
      }
    }
  }
}

customElements.define(HelloWorldElement.is, HelloWorldElement);
